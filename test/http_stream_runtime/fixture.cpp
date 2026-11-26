#include "sdk.hpp"
#include <cstdlib>
#include <functional>
#include <new>
#include <stdexcept>
#include "state_dwell.hpp"
#include "esp_heap_caps.h"
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

static bool   fail_trace_snapshot = false;
static size_t fail_trace_size = 0, trace_caps_calls = 0, trace_caps_failures = 0;
static size_t largest_caps_allocation = 0, trace_caps_sizes[8]{};

void* heap_caps_malloc(size_t size, unsigned) {
    largest_caps_allocation = std::max(largest_caps_allocation, size);
    if (trace_caps_calls < 8) trace_caps_sizes[trace_caps_calls] = size;
    ++trace_caps_calls;
    if (fail_trace_snapshot || (fail_trace_size && size == fail_trace_size)) {
        ++trace_caps_failures;
        return nullptr;
    }
    return std::malloc(size);
}

#include HTTP_COMMON_SOURCE
// Test-only declaration for the negative control that restores the separate provenance read.
namespace daik {
const char* checkup_persist_state();
}
#ifdef HTTP_STREAM_LEGACY_HISTORY
namespace daik::logic {
// The frozen historical handler uses the pre-subsecond signature.
constexpr int64_t history_t0(int64_t now_unix, uint32_t age, size_t n, uint32_t dt) {
    return now_unix - age - static_cast<int64_t>(n ? n - 1 : 0) * dt;
}
} // namespace daik::logic
#endif
#include HTTP_STATUS_SOURCE
#include STATE_DWELL_SOURCE
#include "logic/mcp.hpp"

namespace fixture {
inline std::string                            oracle;
inline daik::Config                           current;
inline std::vector<daik::CachedValue>         rows, modbus_rows;
inline daik::HpValuesIdentity                 identity{"generic", 0x1234, 7, 11};
inline bool                                   ota = false, modbus_live = false;
inline bool                                   ota_brief_busy       = false;
inline const char*                            ota_brief_state      = "idle";
inline bool                                   clock_synced         = true;
inline httpd_req_t*                           active_request       = nullptr;
inline bool                                   config_unreadable    = false;
inline bool                                   change_history_epoch = false;
inline bool                                   history_restored     = false;
inline bool                                   hp_connected         = false;
inline uint32_t                               epoch                = 42;
inline int                                    failure = 0, stage_race = 0;
inline unsigned                               stack_samples = 0;
inline unsigned                               wifi_calls    = 0;
inline daik::WifiScanEntry                    scan_rows[20]{};
inline int                                    scan_count = 0, scan_failure = 0;
inline unsigned                               scan_calls             = 0;
inline size_t                                 scan_first_allocations = 0;
inline daik::CheckupStopContextReport         stop_report{};
inline std::decay_t<decltype(daik::logic::CheckupReport{}.checks[0])> heater_legacy{};
inline bool                                                           heater_legacy_active = false;
inline daik::logic::heater_context::Totals                            heater_totals[2];
inline daik::HeaterContextStatus                                      heater_meta;
inline daik::logic::HeaterContextPayloadFields                        heater_last_snapshot;
inline unsigned heater_snapshot_calls = 0, heater_expire_calls = 0;
inline bool     heater_expire_retires = false, heater_snapshot_before_expire = false;
inline bool     heater_snapshot_mutates = false, heater_snapshot_throws = false;
inline daik::CheckupHydronicReport            hydronic_report{};
inline daik::logic::ModbusHeatingFlowReport   modbus_heating_report{};
inline int                                    flow_min_tenths = -1;
inline daik::logic::DefrostStartReport        defrost_start{};
inline daik::logic::CheckupOutdoorReport      defrost_outdoor{};
inline daik::logic::CheckupCyclingHours       cycling_hours{};
inline daik::logic::CheckupCyclingTrace       cycling_trace{};
inline daik::logic::CheckupRunContextSnapshot cycling_run_contexts{};
inline bool                                   cycling_run_contexts_present = false;
inline daik::logic::DhwLossTimeline           dhw_timelines[2]{};
inline unsigned                               dhw_snapshot_calls[2]{}, checkup_report_calls = 0;
inline bool                                   dhw_evidence_case   = false;
inline unsigned                               dhw_snapshot_chunks = 0;
inline daik::CheckupFaultStatus               fault_status{};
inline daik::logic::CheckupFaultTrace         fault_trace{};
inline bool                                   fault_trace_present = false;
inline daik::logic::CheckupRestore      checkup_persist     = daik::logic::CheckupRestore::NoRecord;
inline bool                             reset_after_checkup = false;
inline unsigned                         stop_report_calls   = 0;
inline unsigned                         hydronic_report_calls      = 0;
inline bool                             checkup_x10a_has_data      = false;
inline bool                             checkup_modbus_has_data    = false;
inline daik::DiagnosticsSource          last_checkup_report_source = daik::DiagnosticsSource::X10a;
inline daik::logic::WorkingFigureReport working_figure_x10a{};
inline daik::logic::WorkingFigureReport working_figure_modbus{};
inline daik::logic::RefrigerantServiceSnapshot refrigerant_report{};
inline unsigned                                refrigerant_report_calls = 0;
inline std::string                             log;
[[noreturn]] void                              fail(const char* message) {
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
    fail_trace_snapshot                     = false;
    fail_trace_size = trace_caps_calls = trace_caps_failures = largest_caps_allocation = 0;
    current                                                                            = {};
    current.profile                                                                    = "generic";
    current.wifi_ssid = "Café \"quoted\"\\line\n";
    current.mqtt_base = "daikin-altherma-esp32";
    ota = modbus_live = change_history_epoch = history_restored = hp_connected = false;
    clock_synced                                                               = true;
    active_request                                                             = nullptr;
    config_unreadable                                                          = false;
    epoch                                                                      = 42;
    failure = stage_race = 0;
    stack_samples = wifi_calls = 0;
    scan_count = scan_failure    = 0;
    scan_calls                   = 0;
    scan_first_allocations       = 0;
    stop_report                  = {};
    heater_legacy                = {};
    heater_legacy_active         = false;
    for (auto& totals : heater_totals) totals = {};
    heater_meta           = {};
    heater_snapshot_calls = heater_expire_calls = 0;
    heater_expire_retires = heater_snapshot_before_expire = false;
    heater_snapshot_mutates = heater_snapshot_throws = false;
    hydronic_report              = {};
    modbus_heating_report        = {};
    flow_min_tenths              = -1;
    defrost_start                = {};
    defrost_outdoor              = {};
    cycling_hours                = {};
    cycling_trace                = {};
    cycling_run_contexts         = {};
    cycling_run_contexts_present = false;
    for (auto& timeline : dhw_timelines) timeline.clear();
    dhw_snapshot_calls[0] = dhw_snapshot_calls[1] = checkup_report_calls = 0;
    dhw_evidence_case                                                    = false;
    dhw_snapshot_chunks                                                  = 0;
    fault_status                                                         = {};
    fault_trace.reset();
    working_figure_x10a        = {};
    working_figure_modbus      = {};
    fault_trace_present        = false;
    checkup_persist            = daik::logic::CheckupRestore::NoRecord;
    reset_after_checkup        = false;
    stop_report_calls          = 0;
    hydronic_report_calls      = 0;
    refrigerant_report         = {};
    refrigerant_report_calls   = 0;
    checkup_x10a_has_data      = false;
    checkup_modbus_has_data    = false;
    last_checkup_report_source = daik::DiagnosticsSource::X10a;
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
        row.label        = i == 0 ? "Flag" : "Temp Café \"quote\"\\unit\n";
        row.value        = i == 0 ? "0" : "12.34567890123456789";
        row.unit         = i == 0 ? "" : "°C";
        row.reg          = i == 0 ? 0x60 : 0x61;
        row.off          = i == 0 ? 12 : static_cast<uint8_t>(i);
        row.conv         = i == 0 ? 300 : 217;
        row.held         = i == 1;
        row.held_unknown = i == 2;
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
    trace_caps_calls = trace_caps_failures = largest_caps_allocation = 0;
    dhw_snapshot_chunks                                              = 0;
    sdk::track_allocations                                           = true;
    active_request                                                   = &req;
    const auto result      = daik::handle_then_settle_body(&req);
    active_request         = nullptr;
    sdk::track_allocations = false;
    sdk::fail_allocation   = 0;
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
std::string_view checkup_wire(const httpd_req_t& req, const char* id) {
    const auto key   = std::string{"{\"id\":\""} + id + "\"";
    const auto start = req.response.find(key);
    check(start != std::string::npos, "status omitted the requested check row");
    const auto end = req.response.find(",{\"id\":", start + key.size());
    check(end != std::string::npos, "check-row oracle did not find its next row boundary");
    return std::string_view(req.response).substr(start, end - start);
}
void maximum_scan() {
    scan_count = 20;
    for (int i = 0; i < scan_count; ++i) {
        std::memset(scan_rows[i].ssid, 0x80, 32);
        scan_rows[i].ssid[32] = '\0';
        scan_rows[i].rssi = static_cast<int8_t>(i == 0 ? -128 : i == 18 ? 0 : i == 19 ? 127 : -i);
    }
}
void configure_stop_context() {
    stop_report                 = {};
    stop_report.capability_mask = 27; // defrost unsupported; other inputs supported
    stop_report.pending         = true;
    auto& report                = stop_report.observation;
    report.confirmed            = true;
    report.readable_us          = 3600123456;
    report.observed_hours       = 2;
    report.dropped              = 9; // independent loss watermark, not a disjoint stop population
    report.restore_pending      = false;
    report.persistence_pending  = true;
    auto& c                     = report.counters;
    c.witnessed_stops_recent_heating = 7;
    const uint16_t positive[]        = {3, 4, 5, 2, 3};
    const uint16_t evaluable[]       = {6, 7, 7, 5, 6};
    const uint16_t complete[]        = {4, 5, 6, 3, 4};
    for (size_t k = 0; k < daik::logic::STOP_CONTEXT_CATEGORIES; ++k) {
        c.positive[k]  = positive[k];
        c.evaluable[k] = evaluable[k];
        c.complete[k]  = complete[k];
    }
    c.unclassified   = 1;
    c.unknown        = 2;
    c.partial        = 3;
    c.censored       = 2;
    c.target_changed = 1;
    c.saturated      = true;
}
void configure_heater_context() {
    using namespace daik::logic;
    heater_meta.epoch = 73;
    heater_meta.capabilities =
        heater_context::ALL ^ heater_context::mask(heater_context::Category::ColdOutdoor);
    heater_meta.supported_heaters = 3;
    heater_meta.confirmed = heater_meta.dated = true;
    heater_meta.restore_pending               = false;
    heater_meta.persistence_pending           = true;
    heater_meta.flags                         = heater_cohort::Partial | heater_cohort::Loss;
    heater_meta.dropped                       = 3;
    for (unsigned h = 0; h < 2; ++h) {
        auto& c                       = heater_totals[h];
        c                             = {};
        heater_meta.observed_hours[h] = uint8_t(h + 1);
        c.readable_us                 = (h ? 20 : 10) * 1000000u;
        c.on_us                       = (h ? 7 : 3) * 1000000u;
        c.off_us                      = c.readable_us - c.on_us;
        c.samples = c.readable_samples = h ? 5 : 4;
        c.on_samples                   = h ? 3 : 2;
        c.unknown_context_us           = c.on_us;
        c.union_us                     = (h ? 5 : 3) * 1000000u;
        c.unclassified_us              = c.on_us - c.union_us;
        const auto emergency           = size_t(heater_context::Category::Emergency);
        const auto silent              = size_t(heater_context::Category::Silent);
        c.positive_us[emergency]       = (h ? 5 : 1) * 1000000u;
        c.evaluable_on_us[emergency] = c.evaluable_on_us[silent] = c.on_us;
        c.evaluable_on_samples[emergency] = c.evaluable_on_samples[silent] = c.on_samples;
        c.positive_samples[emergency]                                      = 1;
        if (!h) {
            c.positive_us[silent]      = 2000000;
            c.positive_samples[silent] = 1;
        }
        // A conservative wire guard must hide old counters after this capability is withdrawn.
        const auto cold     = size_t(heater_context::Category::ColdOutdoor);
        c.positive_us[cold] = c.evaluable_on_us[cold] = c.on_us;
        c.positive_samples[cold] = c.evaluable_on_samples[cold] = c.on_samples;
    }
}
void stop_wire_parity(const httpd_req_t& req) {
    std::string expected;
    daik::append_stop_context_json(expected, daik::stop_context_payload_fields(stop_report));
    check(req.response.find("\"stop_context\":" + expected) != std::string::npos,
          "STOP_HTTP_SHARED_OUTPUT_MATCHES_ORIGINAL_BUILDER_BYTES");
}
httpd_req_t heater_wire(const char* name) {
    auto       req       = request();
    const auto snapshots = heater_snapshot_calls, expires = heater_expire_calls;
    check(invoke(req, "/status", daik::h_status) == ESP_OK, "heater status failed");
    successful(req);
    check(heater_snapshot_calls == snapshots + 1 && heater_expire_calls == expires + 1 &&
              !heater_snapshot_before_expire,
          "HEATER_STATUS_ONE_ATOMIC_SNAPSHOT_AFTER_EXPIRY");
    std::string reference;
    daik::logic::append_heater_context_json(reference, heater_last_snapshot);
    check(req.response.find(reference) != std::string::npos,
          "HEATER_SHARED_OUTPUT_MATCHES_ORIGINAL_NESTED_BUILDER");
    emit(req, name);
    return req;
}
void configure_refrigerant() {
    // This shaped service snapshot is a wire adapter, not a simulated poll/accumulator.
    current.fp_valid                        = true;
    refrigerant_report                      = {};
    refrigerant_report.state                = daik::logic::RefrigerantServiceState::Limited;
    refrigerant_report.blocker              = daik::logic::RefrigerantServiceBlocker::None;
    refrigerant_report.mode                 = daik::logic::RefrigerantServiceMode::Heating;
    refrigerant_report.limitation_mask      = daik::logic::RefrigerantServicePressureSides;
    refrigerant_report.coverage_evaluated   = true;
    refrigerant_report.special_phases_known = true;
    refrigerant_report.continuous_s         = 30;
    refrigerant_report.samples              = 7;
    refrigerant_report.source_generation    = 31;
    refrigerant_report.rps                  = {true, 7, 200, 250, 300};
    refrigerant_report.discharge            = {true, 7, 601, 652, 703};
    refrigerant_report.eev_command          = {true, 7, 1000, 1200, 1400};
    // Three paired sweeps, three high-only sweeps and one low-only sweep.
    refrigerant_report.high_pressure = {true, 6, 121, 142, 163};
    refrigerant_report.low_pressure  = {true, 4, 11, 22, 33};
    refrigerant_report.sources       = {{true, 0x30, 0, 152},
                                        {true, 0x20, 4, 105},
                                        {true, 0x30, 3, 151},
                                        {true, 0x62, 15, 105},
                                        {true, 0x20, 14, 105}};
}
void clear_refrigerant_metrics() {
    refrigerant_report.samples         = 0;
    refrigerant_report.continuous_s    = 0;
    refrigerant_report.rps             = {};
    refrigerant_report.discharge       = {};
    refrigerant_report.eev_command     = {};
    refrigerant_report.high_pressure   = {};
    refrigerant_report.low_pressure    = {};
    refrigerant_report.limitation_mask = daik::logic::RefrigerantServiceNoLimitation;
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
Config         config() { return fixture::current; }
std::string    config_profile() { return fixture::current.profile; }
bool           config_stored_blob_unreadable() { return fixture::config_unreadable; }
bool           hw_octal_spi() { return false; }
bool           provisioning_ap_active() { return false; }
bool           ota_download_active() { return fixture::ota; }
bool           ota_busy() { return fixture::ota; }
OtaStatusBrief ota_status_brief() {
    OtaStatusBrief out{};
    out.busy  = fixture::ota_brief_busy;
    out.state = fixture::ota_brief_state;
    return out;
}
size_t   heap_largest_internal_block() { return 32768; }
uint8_t  heap_guard_restarts() { return 0; }
void     stack_watch_sample(StackWatch) noexcept { ++fixture::stack_samples; }
uint32_t stack_watch_min_free_bytes(StackWatch) noexcept { return 0; }
WifiInfo wifi_info() {
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
EthInfo      net_eth_info() { return {}; }
EthPins      net_eth_pins() { return {}; }
ReservedPins net_eth_reserved_pins() { return {}; }
NetLink      net_kind() { return NetLink::Wifi; }
bool         safe_mode_active() { return false; }
const char*  safe_mode_cause() { return nullptr; }
CrashInfo    diag_crash_info() { return {}; }
CrashInfo    diag_crash_info_live() { return {}; }
bool         diag_crash_coredump_present() { return false; }
void         diag_printf(const char*, ...) {}
Env3Status   env3_status() {
    if (!fixture::current.env3_enabled) return {};
    Env3Status sample;
    sample.started       = true;
    sample.connected     = true;
    sample.fresh         = true;
    sample.temperature_c = 8.5f;
    sample.humidity_pct  = 71.25f;
    sample.pressure_hpa  = 1016.75f;
    sample.samples       = 1;
    sample.error         = "";
    return sample;
}
MqttStatus              mqtt_status() { return {}; }
MqttSkipStats           mqtt_skip_stats() { return {}; }
uint32_t                mqtt_retirement_evidence() noexcept { return 0; }
CirculationSourceStatus circulation_source_status(const Config&) { return {}; }
CirculationPumpSample   circulation_pump_sample() { return {}; }
SyslogStatus            syslog_status() { return {}; }
HpStats                 hp_stats() {
    HpStats s;
    s.connected = fixture::hp_connected;
    return s;
}
uint32_t                          hp_skipped_cycles() { return 0; }
logic::RefrigerantServiceSnapshot refrigerant_service_status() {
    ++fixture::refrigerant_report_calls;
    return fixture::refrigerant_report;
}
ModbusStatus mb_status() {
    ModbusStatus s;
    s.enabled   = fixture::modbus_live;
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
        meta->newest_age_s     = fixture::history_restored ? 0 : 10;
        meta->oldest_bucket    = fixture::history_restored ? -288 : 100;
        meta->newest_commit_us = fixture::history_restored ? 0 : sdk::now - 10000000;
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
    s.synced    = fixture::clock_synced;
    s.unix_time = fixture::clock_synced ? 2000000000 : 0;
    return s;
}
void time_now(int64_t& seconds, int32_t& ms) {
    seconds = !fixture::clock_synced ? 0 : fixture::history_restored ? 2000000100 : 2000000000;
    ms      = fixture::clock_synced && fixture::history_restored ? 100 : 0;
}
const char* checkup_persist_state() {
    return logic::checkup_restore_slug(fixture::checkup_persist);
}
bool checkup_has_data(DiagnosticsSource source) {
    return source == DiagnosticsSource::Modbus ? fixture::checkup_modbus_has_data
                                               : fixture::checkup_x10a_has_data;
}
logic::CheckupReport checkup_report(logic::CheckupCyclingHours* hours,
                                    logic::CheckupCyclingTrace* trace,
                                    logic::CheckupRestore* persist, DiagnosticsSource source,
                                    logic::DefrostStartReport* defrost_context,
                                    logic::DhwLossTimeline*    dhw_trace) {
    ++fixture::checkup_report_calls;
    fixture::last_checkup_report_source = source;
    if (hours) *hours = fixture::cycling_hours;
    if (trace) *trace = fixture::cycling_trace;
    if (persist) *persist = fixture::checkup_persist;
    if (dhw_trace) {
        const auto slot = source == DiagnosticsSource::Modbus ? 1 : 0;
        ++fixture::dhw_snapshot_calls[slot];
        *dhw_trace = fixture::dhw_timelines[slot];
        if (fixture::active_request) fixture::dhw_snapshot_chunks = fixture::active_request->chunks;
    }
    logic::CheckupReport report{};
    if (fixture::dhw_evidence_case) {
        // Deliberately unlike the timed records: hourly/restored aggregate maxima and counts are
        // a separate population. Neither endpoint times nor bar heights may be reconstructed.
        auto& dhw               = report.checks[static_cast<size_t>(logic::CheckupCheck::DhwLoss)];
        dhw.verdict             = logic::CheckupVerdict::Info;
        dhw.reason              = logic::CheckupReason::None;
        dhw.observed_s          = 28000;
        dhw.a                   = 45;
        dhw.b                   = 8;
        dhw.c                   = 3;
        dhw.d                   = 2;
        dhw.e                   = 1;
        dhw.f                   = 600;
        dhw.g                   = 7200;
        report.dhw_draw_windows = 4;
        report.dhw_pump_windows = 5;
        report.dhw_quiet_high_windows = 1;
        report.dhw_candidate_s        = 137;
        report.dhw_settle_remaining_s = 19;
        report.dhw_aborts             = 2;
        report.dhw_best_aborted_s     = 119;
        report.dhw_abort_reasons      = logic::DHW_ABORT_READING | logic::DHW_ABORT_BLIND;
    }
    if (source == DiagnosticsSource::X10a) {
        if (defrost_context) *defrost_context = fixture::defrost_start;
        report.defrost_outdoor = fixture::defrost_outdoor;
        auto& defrost          = report.checks[static_cast<size_t>(logic::CheckupCheck::Defrost)];
        defrost.a              = 3;
        defrost.e              = 3;
        defrost.b              = 15;
        defrost.c              = 151;
        defrost.d              = 1000;
        if (fixture::defrost_outdoor.samples > 0) {
            defrost.verdict    = logic::CheckupVerdict::Info;
            defrost.reason     = logic::CheckupReason::None;
            defrost.observed_s = 86400;
            report.source_fresh = true;
            report.source_age_s = 1;
        }
        if (fixture::flow_min_tenths >= 0)
            report.checks[static_cast<size_t>(logic::CheckupCheck::Flow)].a =
                fixture::flow_min_tenths;
        if (fixture::heater_legacy_active)
            report.checks[static_cast<size_t>(logic::CheckupCheck::Heater)] =
                fixture::heater_legacy;
    } else if (defrost_context) {
        *defrost_context = {};
    }
    if (fixture::reset_after_checkup) {
        if (fixture::checkup_persist == logic::CheckupRestore::Flash) report.covered_s = 1200;
        // Model a producer reset immediately after the captured report releases its lock.
        fixture::checkup_persist = logic::CheckupRestore::ModelChanged;
        fixture::cycling_hours   = {};
    }
    return report;
}
logic::WorkingFigureReport checkup_working_figure_status(const Config&, DiagnosticsSource source) {
    return source == DiagnosticsSource::Modbus ? fixture::working_figure_modbus
                                               : fixture::working_figure_x10a;
}
CheckupHydronicReport checkup_hydronic_report() {
    ++fixture::hydronic_report_calls;
    return fixture::hydronic_report;
}
logic::ModbusHeatingFlowReport checkup_modbus_heating_report() {
    return fixture::modbus_heating_report;
}
CheckupFaultStatus checkup_fault_latest_status(DiagnosticsSource, bool source_fresh) {
    if (fixture::fault_trace_present) {
        CheckupFaultStatus st;
        st.diagnostics_enabled = fixture::current.diagnostics_enabled;
        st.source_live         = fixture::fault_trace.live && source_fresh;
        st.latest = logic::checkup_fault_latest_extract(fixture::fault_trace, source_fresh);
        return st;
    }
    return fixture::fault_status;
}
bool checkup_fault_timeline_snapshot(logic::CheckupFaultTrace& out, DiagnosticsSource) {
    if (!fixture::current.diagnostics_enabled || !fixture::fault_trace_present) {
        out.reset();
        return false;
    }
    out = fixture::fault_trace;
    return out.count > 0;
}
CheckupStopContextReport checkup_stop_context_report() {
    ++fixture::stop_report_calls;
    return fixture::stop_report;
}
void checkup_heater_context_expire() {
    ++fixture::heater_expire_calls;
    if (fixture::heater_expire_retires) fixture::heater_meta.confirmed = false;
}
void heater_context_payload(logic::HeaterContextPayloadFields& out) {
    ++fixture::heater_snapshot_calls;
    fixture::heater_snapshot_before_expire |=
        fixture::heater_snapshot_calls > fixture::heater_expire_calls;
    if (fixture::heater_snapshot_throws) throw std::bad_alloc();
    logic::heater_context_payload_project(out, fixture::heater_totals, fixture::heater_meta);
    fixture::heater_last_snapshot = out;
    if (fixture::heater_snapshot_mutates) {
        fixture::heater_meta.epoch      = 99;
        fixture::heater_totals[1].on_us = 99000000;
    }
}
bool checkup_has_cycling_run_contexts(DiagnosticsSource source, uint32_t, uint32_t) {
    return source == DiagnosticsSource::X10a && fixture::current.diagnostics_enabled &&
           fixture::cycling_run_contexts_present && fixture::cycling_run_contexts.count > 0;
}
bool checkup_cycling_run_contexts(daik::logic::CheckupRunContextSnapshot& out, uint32_t boot_s,
                                  DiagnosticsSource source, uint32_t timeline_unix_s) {
    if (source != DiagnosticsSource::X10a || !fixture::current.diagnostics_enabled ||
        !fixture::cycling_run_contexts_present) {
        out.reset();
        return false;
    }
    fixture::check(boot_s == fixture::cycling_trace.boot_s &&
                       timeline_unix_s == fixture::cycling_trace.unix_s,
                   "cycling run contexts are not in the emitted chart's time frame");
    out = fixture::cycling_run_contexts;
    return out.count > 0;
}
size_t diag_dump(char* out, size_t cap) {
    const size_t n = std::min(cap, fixture::log.size());
    std::memcpy(out, fixture::log.data(), n);
    return n;
}
DiagStreamCursor diag_stream_open(size_t max) {
    return diag_stream_begin(fixture::log.data(), kDiagRingBytes, fixture::log.size(), false,
                             fixture::log.size(), max);
}
size_t diag_stream_next(DiagStreamCursor& cursor, char* out, size_t cap, bool whole_lines) {
    return diag_stream_read(cursor, fixture::log.data(), kDiagRingBytes, fixture::log.size(), out,
                            cap, whole_lines);
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
            if (handler == daik::h_history)
                check(req.response.find(R"("label":"Supply Café \"quote\"\\line\n")") !=
                          std::string::npos,
                      "ordinary history label lost its JSON escaping");
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
    run("cycling_hours_wire", [] {
        using Slot                  = daik::logic::CheckupCyclingSlot;
        current.diagnostics_enabled = true;
        cycling_hours.epoch         = 17;
        cycling_hours.count         = 2;
        cycling_hours.end_unix_s[0] = 1'999'998'000;
        // An older restored hour has a negative bucket ID. Only parts of its observed runtime
        // are attributable to the two positively witnessed modes.
        cycling_hours.hours[0]     = {2700, 1200, 600, 300, 2, Slot::Restored};
        using Trace                = daik::logic::CheckupCyclingTrace;
        cycling_trace.unix_s       = 2'000'000'000;
        cycling_trace.window_end_s = 86400;
        cycling_trace.end_s        = 86399;
        cycling_trace.boot_s       = 451;
        cycling_trace.live         = true;
        cycling_trace.push(86359, Trace::Off);
        cycling_trace.push(86369, Trace::Start);
        cycling_trace.push(86369, Trace::Heat);
        cycling_trace.push(86389, Trace::Off);
        cycling_trace.push(86390, Trace::Stop);
        for (const bool partial : {true, false}) {
            cycling_hours.pending_elapsed_s = partial ? 450 : 0;
            cycling_hours.hours[1] = partial ? daik::logic::CheckupCyclingHour{420, 180, 0, 60, 1}
                                             : daik::logic::CheckupCyclingHour{0, 0, 0, 0, 1};
            auto req               = request();
            check(invoke(req, "/status", daik::h_status) == ESP_OK, "cycling status failed");
            successful(req);
            const auto elapsed = req.response.find("\"elapsed_s\":");
            check(elapsed != std::string::npos &&
                      req.response.find("\"elapsed_s\":", elapsed + 1) == std::string::npos,
                  "elapsed time must be serialized once for the open hour only");
            emit(req, partial ? "cycling-partial" : "cycling-edge");
        }
        auto redacted = request();
        check(invoke(redacted, "/status?redact=1", daik::h_status) == ESP_OK,
              "redacted cycling status failed");
        successful(redacted);
        check(redacted.response.find("\"timeline\"") == std::string::npos,
              "redacted status omits detailed cycling trace");
        auto constrained    = request();
        fail_trace_snapshot = true;
        const auto result   = invoke(constrained, "/status", daik::h_status);
        fail_trace_snapshot = false;
        check(result == ESP_OK, "status must survive optional trace allocation failure");
        successful(constrained);
        emit(constrained, "cycling-trace-oom");
        cycling_trace                     = {};
        cycling_hours.hours[0]            = {};
        cycling_hours.hours[0].provenance = Slot::Expired;
        cycling_hours.end_unix_s[0]       = 0;
        auto req                          = request();
        check(invoke(req, "/status", daik::h_status) == ESP_OK, "expired cycling status failed");
        successful(req);
        emit(req, "cycling-expired");
    });
    run("dhw_timeline_wire", [] {
        using Timeline = daik::logic::DhwLossTimeline;
        using Trace    = daik::logic::CheckupCyclingTrace;
        check(sizeof(Timeline) == 408 && sizeof(daik::logic::DhwLossTraceWindow) == 16,
              "DHW optional snapshot exceeded its bounded wire-test budget");
        current.diagnostics_enabled = true;
        current.mb_host             = "homehub-fixture";
        checkup_x10a_has_data = checkup_modbus_has_data = true;
        dhw_evidence_case                               = true;
        cycling_hours.epoch                             = 17;
        cycling_hours.count                             = 2;
        cycling_hours.pending_elapsed_s                 = 137;
        cycling_hours.hours[0]                          = {3600, 1800, 900, 900, 2};
        cycling_hours.hours[1]                          = {120, 60, 0, 60, 1};

        auto& x10a          = dhw_timelines[0];
        x10a.epoch          = 71;
        x10a.window_end_s   = 172800;
        x10a.since_s        = 80000;
        x10a.observed_end_s = 172799;
        x10a.unix_s         = 2000000000;
        x10a.observed = x10a.live = true;
        x10a.count                = 24;
        for (uint32_t i = 0; i < x10a.count; ++i) {
            // The first independently floored endpoint pair is 3631 s wide. Its completion is
            // retained even though its real start precedes the frame's 86400 s left edge.
            x10a.windows[i] = {i ? 86400 + i * 3600 : 86369,
                               90000 + i * 3600,
                               static_cast<uint16_t>((i * 7) % 25),
                               static_cast<uint16_t>(i ? 3600 - (i % 5) * 19 : 3599),
                               i % 2 != 0,
                               i % 3 == 2,
                               static_cast<daik::logic::DhwCircState>(i % 4)};
        }
        const auto full       = x10a;
        auto&      modbus     = dhw_timelines[1];
        modbus.epoch          = 83;
        modbus.window_end_s   = 174000;
        modbus.since_s        = 166000;
        modbus.observed_end_s = 173999;
        modbus.unix_s         = 1999999993;
        modbus.observed       = true;
        modbus.live           = false;
        modbus.count          = 1;
        modbus.windows[0]     = {
            169400, 173000, 33, 3581, false, true, daik::logic::DhwCircState::OffSettled};

        const auto framed = +[](httpd_req_t* req) {
            // The same pure framing helpers used by MCP get_status, not a second serializer.
            std::string prefix, suffix;
            daik::mcp_result_begin(prefix, "73");
            daik::mcp_tool_result_begin(prefix, "Current device and heat-pump status.");
            daik::mcp_tool_result_end(suffix);
            daik::mcp_result_end(suffix);
            return daik::http_send_status_json(req, prefix, suffix, false);
        };
        auto send = [&](const char* name, bool visible, bool copied, bool mcp = false,
                        bool redact = false) {
            const auto     source          = current.diagnostics_source;
            const auto     slot            = source == daik::DiagnosticsSource::Modbus ? 1 : 0;
            const unsigned snapshots       = dhw_snapshot_calls[slot];
            const unsigned other_snapshots = dhw_snapshot_calls[1 - slot];
            const unsigned reports         = checkup_report_calls;
            auto           req             = request();
            check(invoke(req,
                         mcp      ? "/mcp"
                         : redact ? "/status?redact=1"
                                  : "/status",
                         mcp ? framed : daik::h_status) == ESP_OK,
                  "DHW status or shared MCP builder failed");
            successful(req);
            check(checkup_report_calls == reports + 1 && last_checkup_report_source == source &&
                      dhw_snapshot_calls[slot] == snapshots + (copied ? 1 : 0) &&
                      dhw_snapshot_calls[1 - slot] == other_snapshots,
                  "DHW snapshot mixed sources, was copied more than once, or bypassed admission");
            const auto row = checkup_wire(req, "dhw_loss");
            check((row.find("\"timeline\":") != std::string_view::npos) == visible,
                  "DHW timeline must be an optional object, not null, empty or leaked on refusal");
            check(row.find("\"max_k_h\":4.5,\"windows\":8") != std::string_view::npos &&
                      checkup_wire(req, "cycling").find("\"hours_epoch\":17,\"hours\":[") !=
                          std::string_view::npos,
                  "optional DHW detail changed aggregate evidence or lost cycling hours");
            check(sdk::largest_allocation <= 2048 && largest_caps_allocation <= 1024,
                  "DHW status materialized an unbounded body or optional allocation");
            emit(req, name);
            return req;
        };

        auto maximum = send("dhw-x10a", true, true);
        check(maximum.chunks >= dhw_snapshot_chunks + 2,
              "the maximum DHW response must emit multiple bounded chunks after the snapshot");
        const auto maximum_row = checkup_wire(maximum, "dhw_loss");
        check(
            maximum_row.find("{\"start_s\":86369,\"end_s\":90000,\"rate_k_h\":0.0,"
                             "\"observed_s\":3599,\"pump_marker\":false,\"draw_marker\":false,"
                             "\"circulation\":\"unknown\"}") != std::string_view::npos &&
                maximum_row.find("\"observed_s\":3581,\"pump_marker\":true,\"draw_marker\":false,"
                                 "\"circulation\":\"on\"}") != std::string_view::npos &&
                maximum_row.find("\"observed_s\":3562,\"pump_marker\":false,\"draw_marker\":true,"
                                 "\"circulation\":\"off\"}") != std::string_view::npos &&
                maximum_row.find("\"circulation\":\"off_settled\"}") != std::string_view::npos,
            "DHW wire lost a real 3631-second endpoint, numeric zero, coverage or paired markers");
        size_t records = 0;
        for (size_t pos = 0;
             (pos = maximum_row.find("\"start_s\":", pos)) != std::string_view::npos; ++pos)
            ++records;
        unsigned dhw_allocations = 0;
        check(trace_caps_calls <= 8, "optional allocation witness overflowed");
        for (size_t i = 0; i < trace_caps_calls; ++i)
            if (trace_caps_sizes[i] == sizeof(Timeline)) ++dhw_allocations;
        check(records == 24 && maximum_row.size() > 3 * 1024 && dhw_allocations == 1,
              "maximum DHW detail was truncated, synthesized, or not one bounded snapshot");
        std::printf("DHW records=%zu row_bytes=%zu chunks=%u max_chunk=%zu "
                    "largest_allocation=%zu largest_caps_allocation=%zu snapshot_bytes=%zu "
                    "snapshot_chunks=%u\n",
                    records, maximum_row.size(), maximum.chunks, maximum.max_chunk,
                    sdk::largest_allocation, largest_caps_allocation, sizeof(Timeline),
                    dhw_snapshot_chunks);
        send("dhw-mcp-x10a", true, true, true);
        current.diagnostics_source = daik::DiagnosticsSource::Modbus;
        send("dhw-modbus", true, true);
        send("dhw-mcp-modbus", true, true, true);
        current.diagnostics_source = daik::DiagnosticsSource::X10a;

        clock_synced  = false;
        x10a.unix_s   = 0;
        auto unsynced = send("dhw-no-sntp", true, true);
        check(checkup_wire(unsynced, "dhw_loss").find("\"unix_s\":") == std::string_view::npos,
              "DHW serializer invented a wall-clock anchor without SNTP");
        x10a.clear();
        x10a.epoch           = 73;
        x10a.window_end_s    = 1800;
        x10a.observed_end_s  = 1234; // Unknown flag wins over a residual scalar.
        auto       empty     = send("dhw-empty-unobserved", true, true);
        const auto empty_row = checkup_wire(empty, "dhw_loss");
        check(empty_row.find("\"observed_end_s\":null,\"live\":false,\"windows\":[]}") !=
                  std::string_view::npos,
              "an eligible empty DHW frame must preserve unknown observation time");
        check(maximum.response.size() > empty.response.size() + 2048 &&
                  maximum.chunks >= empty.chunks + 2,
              "24 DHW windows did not traverse multiple bounded transport chunks");
        x10a.epoch        = 74;
        x10a.window_end_s = x10a.observed_end_s = 0;
        x10a.observed                           = true;
        auto zero                               = send("dhw-empty-observed-zero", true, true);
        check(checkup_wire(zero, "dhw_loss").find("\"observed_end_s\":0,") !=
                  std::string_view::npos,
              "known boot-time DHW observation zero became unknown");
        x10a         = full;
        x10a.epoch   = 0; // Even residual records cannot make an ineligible snapshot visible.
        clock_synced = true;
        send("dhw-epoch-zero", false, true);
        x10a                        = full;
        current.diagnostics_enabled = false;
        send("dhw-disabled", false, false);
        check(trace_caps_calls == 0, "disabled diagnosis allocated optional trace buffers");
        current.diagnostics_enabled = true;
        send("dhw-redacted", false, false, false, true);
        check(trace_caps_calls == 0, "redacted status allocated optional trace buffers");

        cycling_trace.unix_s       = 2000000000;
        cycling_trace.window_end_s = 86400;
        cycling_trace.end_s        = 86399;
        cycling_trace.boot_s       = 451;
        cycling_trace.live         = true;
        cycling_trace.push(86359, Trace::Off);
        cycling_trace.push(86369, Trace::Heat);
        fail_trace_snapshot = true;
        auto all_oom        = send("dhw-all-trace-oom", false, false);
        check(trace_caps_failures >= 2 &&
                  checkup_wire(all_oom, "cycling").find("\"timeline\":") == std::string_view::npos,
              "all optional trace OOM did not preserve only the compact status");
        fail_trace_snapshot = false;
        fail_trace_size     = sizeof(Timeline);
        auto dhw_oom        = send("dhw-only-oom", false, false);
        check(trace_caps_failures == 1 &&
                  checkup_wire(dhw_oom, "cycling").find("\"timeline\":{") != std::string_view::npos,
              "DHW-only OOM removed the independently available cycling timeline");
        send("dhw-mcp-only-oom", false, false, true);
        fail_trace_size  = sizeof(Trace);
        auto cycling_oom = send("dhw-cycling-oom", true, true);
        check(trace_caps_failures == 1 && cycling_oom.chunks >= dhw_snapshot_chunks + 2 &&
                  checkup_wire(cycling_oom, "cycling").find("\"timeline\":") ==
                      std::string_view::npos,
              "cycling-only OOM dropped or truncated the surviving DHW snapshot");
        fail_trace_size = 0;
        send("dhw-recovered", true, true);
        allocation_sweep("/status", daik::h_status);
        chunk_sweep("/status", daik::h_status);
        allocation_sweep("/mcp", framed);
        chunk_sweep("/mcp", framed);
    });
    run("checkup_persist_snapshot", [] {
        const auto framed = +[](httpd_req_t* req) {
            return daik::http_send_status_json(req, "{\"result\":", "}", false);
        };
        current.diagnostics_enabled = true;
        reset_after_checkup         = true;
        for (unsigned path = 0; path < 3; ++path) {
            checkup_persist             = daik::logic::CheckupRestore::Flash;
            cycling_hours.epoch         = 17;
            cycling_hours.count         = 2;
            cycling_hours.end_unix_s[0] = 1'999'998'000;
            cycling_hours.hours[0]      = {1200, 600, 600,
                                           0,    2,   daik::logic::CheckupCyclingSlot::Restored};
            const char* uri             = path == 1 ? "/status?redact=1" : "/status";
            const auto  handler         = path == 2 ? framed : daik::h_status;
            auto        req             = request();
            check(invoke(req, uri, handler) == ESP_OK, "diagnosis status failed");
            successful(req);
            check(checkup_persist == daik::logic::CheckupRestore::ModelChanged &&
                      cycling_hours.count == 0,
                  "fixture did not retire the captured restore generation");
            check(req.response.find("\"persist\":\"flash\"") != std::string::npos,
                  "health.persist came from after the captured diagnosis window");
            emit(req, path == 0   ? "checkup-persist-plain"
                      : path == 1 ? "checkup-persist-redacted"
                                  : "checkup-persist-framed");
        }
        reset_after_checkup = false;
        checkup_persist     = daik::logic::CheckupRestore::Unknown;
        auto req            = request();
        check(invoke(req, "/status", daik::h_status) == ESP_OK,
              "unreadable diagnosis status failed");
        successful(req);
        emit(req, "checkup-persist-unknown");
    });
    run("stop_context_absent", [] {
        for (const bool confirmed : {false, true}) {
            stop_report.observation.confirmed = confirmed;
            stop_report.capability_mask       = confirmed ? 31 : 0;
            auto           req                = request();
            const unsigned calls              = stop_report_calls;
            check(invoke(req, "/status", daik::h_status) == ESP_OK, "absent stop status failed");
            successful(req);
            check(stop_report_calls == calls + 1,
                  "status must take exactly one typed stop snapshot");
            stop_wire_parity(req);
            check(req.response.find("\"witnessed_stops_recent_heating\":null") !=
                          std::string::npos &&
                      req.response.find("\"positive\":null") != std::string::npos,
                  "unreadable stop context fabricated numeric observations");
            emit(req, confirmed ? "stop-unreadable" : "stop-unconfirmed");
        }
    });
    run("stop_context_covered_zero", [] {
        stop_report.observation.confirmed       = true;
        stop_report.observation.readable_us     = 37000001;
        stop_report.observation.observed_hours  = 1;
        stop_report.observation.dated           = true;
        stop_report.observation.partial         = false;
        stop_report.observation.restore_pending = false;
        stop_report.capability_mask             = 31;
        auto req                                = request();
        check(invoke(req, "/status", daik::h_status) == ESP_OK, "zero-population status failed");
        successful(req);
        check(stop_report_calls == 1, "zero population must use one typed stop snapshot");
        stop_wire_parity(req);
        check(req.response.find("\"witnessed_stops_recent_heating\":0") != std::string::npos &&
                  req.response.find("\"positive\":0,\"evaluable\":0,\"complete\":0") !=
                      std::string::npos,
              "readable zero-stop evidence became null or fabricated counts");
        emit(req, "stop-covered-zero");
    });
    run("stop_context_populated", [] {
        cycling_hours.count             = 2;
        cycling_hours.pending_elapsed_s = 3600;
        cycling_hours.hours[0]          = {3600, 1800, 900, 900, 2};
        cycling_hours.hours[1]          = {3600, 600, 0, 0, 1};
        auto empty                      = request();
        check(invoke(empty, "/status", daik::h_status) == ESP_OK,
              "stop allocation baseline failed");
        const size_t baseline_allocations = sdk::allocations;
        configure_stop_context();
        for (const bool redact : {false, true}) {
            auto           req   = request();
            const unsigned calls = stop_report_calls;
            check(invoke(req, redact ? "/status?redact=1" : "/status", daik::h_status) == ESP_OK,
                  "populated stop status failed");
            successful(req);
            check(stop_report_calls == calls + 1,
                  "populated status copied stop snapshot repeatedly");
            stop_wire_parity(req);
            check(sdk::allocations <= baseline_allocations,
                  "compact stop append added allocations over the null-context status");
            check(req.response.find("\"stop_context\":{") != std::string::npos &&
                      req.response.find("\"witnessed_stops_recent_heating\":7") !=
                          std::string::npos,
                  "populated stop context was omitted or changed population");
            check(req.response.find("\"low_rps_above_main_target\":{\"supported\":true,"
                                    "\"positive\":3,\"evaluable\":6,\"complete\":4}") !=
                          std::string::npos &&
                      req.response.find("\"request_withdrawal\":{\"supported\":true,\"positive\":4,"
                                        "\"evaluable\":7,\"complete\":5}") != std::string::npos,
                  "overlapping stop observations were normalized or changed");
            check(req.response.find("\"defrost\":{\"supported\":false,\"positive\":null,"
                                    "\"evaluable\":null,\"complete\":null}") != std::string::npos,
                  "unsupported defrost leaked stored counts or fabricated zero");
            emit(req, redact ? "stop-populated-redacted" : "stop-populated");
        }
    });
    run("stop_shared_output", [] {
        configure_stop_context();
        stop_report.observation.counters.witnessed_stops_recent_heating = UINT16_MAX;
        stop_report.observation.readable_us = uint64_t(UINT32_MAX) * 1000000;
        for (bool flat : {false, true}) {
            const auto  fields   = daik::stop_context_payload_fields(stop_report);
            std::string original = flat ? "{\"prefix\":7" : "prefix:", shared = original;
            daik::append_stop_context_json(original, fields, flat);
            auto sink = daik::detail::json_output(shared);
            daik::append_stop_context_json(sink, fields, flat);
            check(shared == original &&
                      (flat ? shared.find(",\"stop_context_confirmed\":") != std::string::npos
                            : shared.find("prefix:{\"confirmed\":") != std::string::npos),
                  "STOP_SHARED_PREFIX_AND_FLAT_FLAGS_MATCH_ORIGINAL_BYTES");
        }
        auto req = request();
        check(invoke(req, "/status", daik::h_status) == ESP_OK,
              "shared stop maximum status succeeds");
        successful(req);
        stop_wire_parity(req);
    });
    run("heater_context_absent", [] {
        (void)heater_wire("heater-unconfirmed");
        heater_meta.confirmed         = true;
        heater_meta.supported_heaters = 3;
        heater_meta.capabilities      = daik::logic::heater_context::ALL;
        const auto unread             = heater_wire("heater-unreadable");
        check(
            unread.response.find("\"buh\":{\"supported\":true,\"readable_s\":null,\"on_s\":null") !=
                std::string::npos,
            "HEATER_UNREADABLE_POPULATION_IS_NULL");
        configure_heater_context();
        heater_meta.supported_heaters = 0;
        const auto absent             = heater_wire("heater-unsupported");
        check(absent.response.find(
                  "\"buh\":{\"supported\":false,\"readable_s\":null,\"on_s\":null") !=
                  std::string::npos,
              "HEATER_UNSUPPORTED_POPULATION_IS_NULL");
    });
    run("heater_context_populated", [] {
        configure_heater_context();
        heater_legacy_active = true;
        heater_legacy        = {};
        heater_legacy.a      = 17;
        heater_legacy.b      = 29;
        heater_legacy.c      = 111;
        heater_legacy.d      = 222;
        const auto req       = heater_wire("heater-populated");
        check(req.response.find(
                  "\"buh_s\":17,\"bsh_s\":29,\"buh_observed_s\":111,\"bsh_observed_s\":222") !=
                  std::string::npos,
              "HEATER_CONTEXT_NEVER_REPLACES_LEGACY_CLOCKS");
        check(req.response.find("\"silent\":{\"supported\":true,\"positive_s\":0,\"evaluable_on_"
                                "s\":7,\"positive_samples\":0}") != std::string::npos,
              "HEATER_EVALUABLE_ZERO_STAYS_NUMERIC");
        check(req.response.find("\"cold_outdoor\":{\"supported\":false,\"positive_s\":null,"
                                "\"evaluable_on_s\":null,\"positive_samples\":null}") !=
                  std::string::npos,
              "HEATER_UNSUPPORTED_CATEGORY_HAS_NO_NUMBERS");
    });
    run("heater_context_seams", [] {
        configure_heater_context();
        for (unsigned h = 0; h < 2; ++h) {
            auto& c       = heater_totals[h];
            c             = {};
            c.readable_us = c.on_us = (h ? 3 : 2) * 1000000u;
            c.union_us = c.unknown_context_us = c.on_us;
            c.positive_us[0] = c.evaluable_on_us[0] = c.on_us;
        }
        const auto time = heater_wire("heater-time-only");
        check(time.response.find("\"buh\":{\"supported\":true,\"readable_s\":2,\"on_s\":2") !=
                      std::string::npos &&
                  time.response.find("\"emergency\":{\"supported\":true,\"positive_s\":2,"
                                     "\"evaluable_on_s\":2,\"positive_samples\":0}") !=
                      std::string::npos,
              "HEATER_TIME_ONLY_SEAM_RETAINS_QUALIFIED_TIME");
        for (auto& c : heater_totals) {
            c               = {};
            c.unreadable_us = 2000000;
        }
        const auto unknown = heater_wire("heater-unknown-only");
        check(unknown.response.find("\"buh\":{\"supported\":true,\"readable_s\":0,\"on_s\":null") !=
                      std::string::npos &&
                  unknown.response.find("\"unreadable_s\":2") != std::string::npos,
              "HEATER_UNKNOWN_ONLY_SEAM_RETAINS_UNREADABLE_TIME");
        auto& c       = heater_totals[0];
        c             = {};
        c.readable_us = c.on_us = c.union_us = c.unknown_context_us = 500000;
        c.samples = c.readable_samples = c.on_samples = 2;
        c.positive_us[0] = c.evaluable_on_us[0] = 500000;
        c.positive_samples[0]                   = 1;
        c.evaluable_on_samples[0]               = 2;
        const auto subsecond                    = heater_wire("heater-subsecond");
        check(subsecond.response.find("\"emergency\":{\"supported\":true,\"positive_s\":0,"
                                      "\"evaluable_on_s\":0,\"positive_samples\":1}") !=
                  std::string::npos,
              "HEATER_POSITIVE_SUBSECOND_SAMPLE_IS_NOT_ABSENCE");
    });
    run("heater_context_atomic", [] {
        configure_heater_context();
        heater_snapshot_mutates = true;
        const auto req          = heater_wire("heater-atomic");
        check(heater_meta.epoch == 99 && heater_totals[1].on_us == 99000000 &&
                  req.response.find("\"epoch\":73") != std::string::npos &&
                  req.response.find("\"bsh\":{\"supported\":true,\"readable_s\":20,\"on_s\":7") !=
                      std::string::npos,
              "HEATER_HTTP_SERIALIZES_ONE_FROZEN_PAIR");
    });
    run("heater_context_maximum", [] {
        configure_heater_context();
        heater_meta.epoch        = UINT32_MAX;
        heater_meta.capabilities = heater_meta.flags = heater_meta.dropped = UINT16_MAX;
        for (auto& c : heater_totals) {
            c.readable_us = c.on_us = c.off_us = c.transition_us = c.unreadable_us = UINT64_MAX;
            c.union_us = c.overlap_us = c.unknown_context_us = c.unclassified_us =
                c.complete_context_us                        = UINT64_MAX;
            c.samples = c.readable_samples = c.on_samples = UINT32_MAX;
            for (size_t k = 0; k < daik::logic::heater_context::CATEGORIES; ++k) {
                c.positive_us[k] = c.evaluable_on_us[k] = UINT64_MAX;
                c.positive_samples[k] = c.evaluable_on_samples[k] = UINT32_MAX;
            }
        }
        (void)heater_wire("heater-maximum");
    });
    run("heater_context_failures", [] {
        configure_heater_context();
        heater_expire_retires = true;
        const auto expired    = heater_wire("heater-expired");
        check(expired.response.find("\"context\":{\"confirmed\":false") != std::string::npos,
              "HEATER_EXPIRY_PRECEDES_WIRE_PUBLICATION");
        heater_expire_retires = false;
        configure_heater_context();
        heater_snapshot_throws = true;
        auto req               = request();
        check(invoke(req, "/status", daik::h_status) == ESP_FAIL && req.emission_attempts > 0 &&
                  req.final_chunks == 0 && req.replacement_responses == 0 &&
                  req.late_status_changes == 0,
              "HEATER_PROVIDER_OOM_ABORTS_COMMITTED_STREAM");
        heater_snapshot_throws = false;
        next_request();
        (void)heater_wire("heater-recovered");
        allocation_sweep("/status", daik::h_status);
        chunk_sweep("/status", daik::h_status);
    });
    run("defrost_start_wire", [] {
        for (const auto& [sample, result] :
             std::initializer_list<std::pair<daik::logic::DefrostStartReport, const char*>>{
                 {{}, "null"},
                 {{5000000, 0, daik::logic::CHECKUP_ABSENT,
                   daik::logic::DefrostStartRoute::Unknown},
                  "{\"unix_s\":null,\"route\":null,\"outdoor_c\":null}"},
                 {{5000000, 2000000000, 0, daik::logic::DefrostStartRoute::Dhw},
                  "{\"unix_s\":2000000000,\"route\":\"dhw_route\",\"outdoor_c\":0.0}"},
                 {{5000000, 2000000000, -25, daik::logic::DefrostStartRoute::SpaceHeating},
                  "{\"unix_s\":2000000000,\"route\":\"space_heating\",\"outdoor_c\":-2.5}"}}) {
            defrost_start = sample;
            auto req      = request();
            check(invoke(req, "/status", daik::h_status) == ESP_OK, "defrost start status failed");
            successful(req);
            const auto expected = std::string{"\"last_observed_start\":"} + result;
            check(req.response.find(expected) != std::string::npos, "defrost start fields changed");
            check(req.response.find("\"count\":3,\"paired_count\":3,\"share_pct\":15,"
                                    "\"defrost_s\":151,\"run_s\":1000") != std::string::npos,
                  "defrost start changed the legacy ratio fields");
        }
        current.diagnostics_enabled = true;
        hp_connected                = true;
        defrost_outdoor             = {daik::logic::OutdoorSource::X10a, -45, -20, 12};
        auto outdoor_req            = request();
        check(invoke(outdoor_req, "/status", daik::h_status) == ESP_OK,
              "defrost outdoor status failed");
        successful(outdoor_req);
        check(outdoor_req.response.find(
                  "\"outdoor_source\":\"x10a\",\"outdoor_min_c\":-4.5,\"outdoor_mean_c\":-2.0,"
                  "\"outdoor_samples\":12") != std::string::npos,
              "defrost outdoor fields missing or malformed");
        emit(outdoor_req, "status-x10a-defrost-outdoor");
    });
    run("refrigerant_metadata", [] {
        configure_refrigerant();
        for (const bool redact : {false, true}) {
            auto           req   = request();
            const unsigned calls = refrigerant_report_calls;
            check(invoke(req, redact ? "/status?redact=1" : "/status", daik::h_status) == ESP_OK,
                  "populated refrigerant status failed");
            successful(req);
            check(refrigerant_report_calls == calls + 1,
                  "status must copy exactly one typed refrigerant snapshot");
            check(req.response.find("\"high_pressure_bar\":{\"samples\":6,\"source\":{"
                                    "\"kind\":\"x10a\",\"reg\":98,\"offset\":15,\"conv\":105}}") !=
                          std::string::npos &&
                      req.response.find(
                          "\"low_pressure_bar\":{\"samples\":4,\"source\":{"
                          "\"kind\":\"x10a\",\"reg\":32,\"offset\":14,\"conv\":105}}") !=
                          std::string::npos,
                  "refrigerant per-input count or selected source differs from the snapshot");
            emit(req, redact ? "refrigerant-populated-redacted" : "refrigerant-populated");
        }
    });
    run("refrigerant_selected_unread", [] {
        configure_refrigerant();
        refrigerant_report.high_pressure        = {};
        refrigerant_report.low_pressure.samples = refrigerant_report.samples;
        for (const bool redact : {false, true}) {
            auto req = request();
            check(invoke(req, redact ? "/status?redact=1" : "/status", daik::h_status) == ESP_OK,
                  "selected but unread refrigerant status failed");
            successful(req);
            check(req.response.find("\"high_pressure_bar\":null") != std::string::npos &&
                      req.response.find(
                          "\"high_pressure_bar\":{\"samples\":0,\"source\":{"
                          "\"kind\":\"x10a\",\"reg\":98,\"offset\":15,\"conv\":105}}") !=
                          std::string::npos &&
                      req.response.find(
                          "\"low_pressure_bar\":{\"samples\":7,\"source\":{"
                          "\"kind\":\"x10a\",\"reg\":32,\"offset\":14,\"conv\":105}}") !=
                          std::string::npos,
                  "one-sided window lost its unread selected source or readable low side");
            emit(req,
                 redact ? "refrigerant-selected-unread-redacted" : "refrigerant-selected-unread");
        }
    });
    run("refrigerant_missing", [] {
        configure_refrigerant();
        refrigerant_report.high_pressure.samples         = refrigerant_report.samples;
        refrigerant_report.low_pressure                  = {};
        refrigerant_report.sources.low_pressure.selected = false;
        auto req                                         = request();
        check(invoke(req, "/status", daik::h_status) == ESP_OK,
              "missing refrigerant input status failed");
        successful(req);
        check(req.response.find("\"low_pressure_bar\":null") != std::string::npos,
              "missing low pressure fabricated measured zero");
        check(req.response.find("\"high_pressure_bar\":{\"samples\":7,\"source\":{"
                                "\"kind\":\"x10a\",\"reg\":98,\"offset\":15,\"conv\":105}}") !=
                      std::string::npos &&
                  req.response.find("\"low_pressure_bar\":{\"samples\":0,\"source\":null}") !=
                      std::string::npos,
              "one-sided window lost the available input or invented a low-side source");
        emit(req, "refrigerant-missing");
    });
    run("refrigerant_resets", [] {
        configure_refrigerant();
        clear_refrigerant_metrics();
        refrigerant_report.state   = daik::logic::RefrigerantServiceState::Interrupted;
        refrigerant_report.blocker = daik::logic::RefrigerantServiceBlocker::PollGap;
        auto req                   = request();
        check(invoke(req, "/status", daik::h_status) == ESP_OK,
              "interrupted refrigerant status failed");
        successful(req);
        check(req.response.find("\"high_pressure_bar\":{\"samples\":0,\"source\":{"
                                "\"kind\":\"x10a\",\"reg\":98,\"offset\":15,\"conv\":105}}") !=
                  std::string::npos,
              "interruption lost the selected source while clearing its sample population");
        emit(req, "refrigerant-gap");
        refrigerant_report.state   = daik::logic::RefrigerantServiceState::Waiting;
        refrigerant_report.blocker = daik::logic::RefrigerantServiceBlocker::MissingFreshData;
        refrigerant_report.source_generation     = 32;
        refrigerant_report.sources.high_pressure = {true, 0x20, 12, 105};
        req                                      = request();
        check(invoke(req, "/status", daik::h_status) == ESP_OK,
              "new-source refrigerant status failed");
        successful(req);
        emit(req, "refrigerant-new-source");
    });
    run("refrigerant_omission", [] {
        configure_refrigerant();
        refrigerant_report.coverage_evaluated = false;
        auto req                              = request();
        check(invoke(req, "/status", daik::h_status) == ESP_OK,
              "unevaluated refrigerant status failed");
        successful(req);
        check(req.response.find("\"refrigerant_service\":") == std::string::npos,
              "unevaluated source invented a refrigerant observation");
        emit(req, "refrigerant-unevaluated");
        refrigerant_report.coverage_evaluated = true;
        current.fp_valid                      = false;
        req                                   = request();
        check(invoke(req, "/status", daik::h_status) == ESP_OK,
              "undetected refrigerant status failed");
        successful(req);
        check(req.response.find("\"refrigerant_service\":") == std::string::npos,
              "undetected profile invented a refrigerant observation");
        emit(req, "refrigerant-undetected");
    });
    run("allocation_failures", [] {
        allocation_sweep("/status", daik::h_status);
        config_unreadable = true;
        allocation_sweep("/status?redact=1", daik::h_status);
        configure_refrigerant();
        allocation_sweep("/status", daik::h_status);
        allocation_sweep("/status?redact=1", daik::h_status);
        config_unreadable = false;
        allocation_sweep("/values", daik::h_values);
        allocation_sweep("/history?row=leaving_water", daik::h_history);
        allocation_sweep("/diag?redact=1", daik::h_diag);
        configure_stop_context();
        allocation_sweep("/status", daik::h_status);
        allocation_sweep("/status?redact=1", daik::h_status);
    });
    run("chunk_failures", [] {
        chunk_sweep("/status", daik::h_status);
        config_unreadable = true;
        chunk_sweep("/status?redact=1", daik::h_status);
        configure_refrigerant();
        chunk_sweep("/status", daik::h_status);
        chunk_sweep("/status?redact=1", daik::h_status);
        config_unreadable = false;
        chunk_sweep("/values", daik::h_values);
        chunk_sweep("/history?row=leaving_water", daik::h_history);
        chunk_sweep("/diag", daik::h_diag);
        chunk_sweep("/diag?redact=1", daik::h_diag);
        configure_stop_context();
        chunk_sweep("/status", daik::h_status);
        chunk_sweep("/status?redact=1", daik::h_status);
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
    run("restored_history_boot_raster", [] {
        history_restored = true;
        sdk::now         = 300000;
        auto req         = request();
        check(invoke(req, "/history?row=leaving_water", daik::h_history) == ESP_OK,
              "restored History response failed");
        successful(req);
        emit(req, "restored-history");
        check(req.response.find("\"boot_b0\":-288") != std::string::npos,
              "the restored ring must retain the negative boot origin on the wire");
        check(req.response.find("\"t0\":1999913999,") != std::string::npos,
              "the wall time and persisted bucket must stay before the UTC boundary");
    });
    run("retired_sources_status_and_history", [] {
        current.diagnostics_enabled = true;
        current.mb_host             = "fixture-homehub.invalid";
        current.board_user_set      = true;
        current.board_preset_id     = daik::BoardPresetId::M5StackAtomS3Lite;
        current.env3_enabled        = true;
        modbus_live                 = true;
        for (const bool redact : {false, true}) {
            auto req = request();
            check(invoke(req, redact ? "/status?redact=1" : "/status", daik::h_status) == ESP_OK,
                  "status failed with configured HomeHub and ENV III");
            successful(req);
            check(req.response.starts_with("{\"status_schema_version\":2,"),
                  "status omitted or changed its explicit schema version");
            emit(req, redact ? "retired-status-redacted" : "retired-status-plain");
        }
        for (const auto& [name, uri] :
             {std::pair{"retired-room-history", "/history?row=room_temp&source=room"},
              std::pair{"invalid-mqtt-history", "/history?row=room_temp&source=mqtt"},
              std::pair{"truncated-history-source",
                        "/history?row=leaving_water&source=modbus-extra"}}) {
            auto req = request();
            check(invoke(req, uri, daik::h_history) == ESP_OK && req.status == "400 Bad Request" &&
                      req.emission_attempts == 0,
                  "a retired or invalid history source reached streaming");
            emit(req, name);
        }
        auto req = request();
        check(invoke(req, "/history?row=env3_temperature&source=env3", daik::h_history) == ESP_OK,
              "ENV III history must remain independently reachable");
        successful(req);
        emit(req, "retained-env3-history");
        req = request();
        check(invoke(req, "/history?row=room_temp&source=modbus", daik::h_history) == ESP_OK,
              "HomeHub room history must remain independently reachable");
        successful(req);
        emit(req, "retained-homehub-room-history");
    });
    run("ota_admission", [] {
        auto req = request();
        check(invoke(req, "/values", daik::h_values) == ESP_OK && fixture_ticks == 0,
              "idle values request waited for an unrelated network operation");
        successful(req);
        ota                                                                = true;
        const std::pair<const char*, esp_err_t (*)(httpd_req_t*)> routes[] = {
            {"/values", daik::h_values}, {"/status", daik::h_status}};
        for (const auto& [uri, handler] : routes) {
            req = request();
            check(invoke(req, uri, handler) == ESP_OK && req.status == "503 Service Unavailable" &&
                      req.emission_attempts == 0 && fixture_ticks == 0,
                  "OTA admission waited or reached a non-OTA serializer");
        }
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
    run("status_modbus_diagnostics", [] {
        current.mb_host                 = "192.0.2.50";
        current.diagnostics_enabled     = true;
        current.diagnostics_source      = daik::DiagnosticsSource::X10a;
        current.elec_price_tenth_mill   = 3000;
        current.gas_price_tenth_mill    = 1000;
        current.tariff_currency         = "CHF";
        working_figure_modbus.supported = true;
        working_figure_modbus.pel_kind  = daik::logic::EnergyPelKind::Modbus;
        working_figure_modbus.state     = daik::logic::WorkingFigureState::Limited;
        working_figure_modbus.flags     = daik::logic::ENERGY_F_LIMITED_BUH;
        working_figure_modbus.heat_kwh  = 12.0;
        working_figure_modbus.elec_kwh  = 3.0;
        working_figure_modbus.az        = 4.0;
        working_figure_x10a.supported   = true;
        working_figure_x10a.pel_kind    = daik::logic::EnergyPelKind::X10aCt;
        working_figure_x10a.state       = daik::logic::WorkingFigureState::Measured;
        working_figure_x10a.heat_kwh    = 8.0;
        working_figure_x10a.elec_kwh    = 2.0;
        working_figure_x10a.az          = 4.0;
        rows.clear();
        checkup_x10a_has_data                                     = false;
        checkup_modbus_has_data                                   = true;
        stop_report.observation.readable_us                       = 10000000;
        stop_report.observation.confirmed                         = true;
        stop_report.capability_mask                               = 31;
        hydronic_report.observation.confirmed                     = true;
        hydronic_report.observation.dated                         = true;
        hydronic_report.observation.totals.observed_us            = 14500001;
        hydronic_report.observation.totals.samples                = 2;
        hydronic_report.observation.totals.first_evidence_unix_us = 2000000000000000;
        hydronic_report.observation.totals.spread                 = {6500, 3000, 3500};
        hydronic_report.current                                   = true;
        hydronic_report.secondary                            = {-1750, 15000001, 2, {0x65, 4, 105}};
        hydronic_report.agree_reason                         = daik::logic::AgreementReason::None;
        hydronic_report.r1_r4_supported                      = true;
        hydronic_report.r2_r1_supported                      = true;
        hydronic_report.agree_limitations                    = daik::logic::AgreementDhwRoute;
        hydronic_report.observation.totals.agree_limitations = daik::logic::AgreementDhwRoute;
        hydronic_report.observation.totals.r1_r4_qualified_us = 35000001;
        hydronic_report.observation.totals.r1_r4_windows      = 1;
        hydronic_report.observation.totals.r1_r4_samples      = 2;
        hydronic_report.observation.totals.r1_r4              = {-500, -300, -100};
        modbus_heating_report.supported                       = true;
        modbus_heating_report.minimum_tenths                  = 52;
        modbus_heating_report.windows.first_bucket            = 500000;
        modbus_heating_report.windows.masks[23]               = 4;
        configure_heater_context();
        const unsigned before_stop_calls          = stop_report_calls;
        const unsigned before_hydronic_calls      = hydronic_report_calls;
        const unsigned before_heater_calls        = heater_snapshot_calls;
        const unsigned before_heater_expire_calls = heater_expire_calls;
        auto           req                        = request();
        check(invoke(req, "/status", daik::h_status) == ESP_OK, "modbus diagnostics status failed");
        successful(req);
        emit(req, "status-modbus-diagnostics");
        check(last_checkup_report_source == daik::DiagnosticsSource::Modbus &&
                  stop_report_calls == before_stop_calls &&
                  hydronic_report_calls == before_hydronic_calls + 1 &&
                  heater_snapshot_calls == before_heater_calls &&
                  heater_expire_calls == before_heater_expire_calls,
              "modbus diagnostics view must consult X10A only for the independent heating minimum "
              "without stop_context, hydronic body, or X10A heater");
        const auto heater_wire_sv = checkup_wire(req, "heater");
        check(heater_wire_sv.find("\"context\":{\"confirmed\":false") != std::string_view::npos,
              "modbus diagnostics must emit unconfirmed heater context without X10A leakage");
        const size_t hydronic_pos = req.response.find("\"hydronic\":{\"confirmed\":false");
        const size_t hydronic_end =
            hydronic_pos == std::string::npos
                ? std::string::npos
                : req.response.find("\"target_supported\":false}", hydronic_pos);
        auto in_hydronic = [&](const char* needle) {
            const size_t pos = req.response.find(needle, hydronic_pos);
            return pos != std::string::npos && pos < hydronic_end;
        };
        check(
            req.response.find("\"health\":{\"source\":\"modbus\"") != std::string::npos &&
                req.response.find(
                    "\"diagnostics\":{\"enabled\":true,\"source\":\"x10a\",\"effective_source\":"
                    "\"modbus\",\"available_sources\":[\"modbus\"]}") != std::string::npos &&
                req.response.find("\"stop_context\":{\"confirmed\":false") != std::string::npos &&
                hydronic_pos != std::string::npos && hydronic_end != std::string::npos &&
                in_hydronic("\"coverage_partial\":false") &&
                in_hydronic("\"restore_pending\":false") &&
                in_hydronic("\"reason_code\":0,\"reason\":\"none\"") &&
                in_hydronic("\"spread_k\":{\"min\":null,\"mean\":null,\"max\":null}") &&
                req.response.find("\"secondary_supply\":null", hydronic_end) != std::string::npos &&
                req.response.find("\"water_agreement\":null", hydronic_end) != std::string::npos,
            "status payload missing modbus diagnostics provenance or empty stop_context/hydronic");
        check(
            req.response.find("\"gas_comparison\":{\"configured\":true,\"elec_price\":0.3,"
                              "\"gas_price\":0.1,\"gas_efficiency_pct\":88,\"currency\":\"CHF\"") !=
                    std::string::npos &&
                req.response.find("\"working_figure\":{\"kind\":\"observation\",\"supported\":true,"
                                  "\"state\":\"limited\"") != std::string::npos &&
                req.response.find("\"pel_source\":\"modbus\"") != std::string::npos &&
                req.response.find("\"limited_buh\":true") != std::string::npos,
            "status payload missing modbus working_figure or gas_comparison");
    });
    run("heating_minimum_status", [] {
        current.mb_host                            = "192.0.2.50";
        current.diagnostics_enabled                = true;
        current.diagnostics_source                 = daik::DiagnosticsSource::X10a;
        checkup_x10a_has_data                      = true;
        flow_min_tenths                            = 65;
        hydronic_report.reason                     = daik::logic::HydronicReason::Settling;
        auto& obs                                  = hydronic_report.observation;
        obs.confirmed                              = true;
        obs.dated                                  = true;
        modbus_heating_report.supported            = true;
        modbus_heating_report.minimum_tenths       = 52;
        modbus_heating_report.windows.first_bucket = 500000;
        modbus_heating_report.windows.masks[23]    = 4;

        auto read = [&](const char* name, bool redacted = false) {
            next_request();
            auto req = request();
            check(invoke(req, redacted ? "/status?redact=1" : "/status", daik::h_status) == ESP_OK,
                  "heating minimum status failed");
            successful(req);
            emit(req, name);
            return req.response;
        };
        const auto fallback = read("heating-modbus-fallback");
        check(fallback.find("\"heating_minimum\":{\"source\":\"modbus\",\"reason\":\"observed\","
                            "\"min_l_min\":5.2,\"minimum_windows\":{") != std::string::npos,
              "an unqualified X10A population hid the Modbus minimum");
        const auto redacted = read("heating-modbus-redacted", true);
        check(redacted.find("\"heating_minimum\":{\"source\":\"modbus\",\"reason\":\"observed\","
                            "\"min_l_min\":5.2,\"minimum_windows\":null}") != std::string::npos,
              "redacted status must keep the measured minimum and withhold its windows");

        obs.totals.samples                = 2;
        obs.totals.first_evidence_unix_us = 1800080000000000;
        obs.totals.last_evidence_unix_us  = 1800082000000000;
        obs.totals.flow                   = {15125, 7125, 8000};
        obs.minimum_windows.first_bucket  = 500000;
        obs.minimum_windows.masks[22]     = 16;
        const auto preferred              = read("heating-x10a-priority");
        check(preferred.find("\"heating_minimum\":{\"source\":\"x10a\",\"reason\":\"observed\","
                             "\"min_l_min\":7.125,\"minimum_windows\":{") != std::string::npos,
              "qualified X10A must take precedence over a lower Modbus result");

        current.diagnostics_source = daik::DiagnosticsSource::Modbus;
        read("heating-x10a-with-modbus-diagnostics");
        current.diagnostics_source  = daik::DiagnosticsSource::X10a;
        current.diagnostics_enabled = false;
        hydronic_report             = {};
        flow_min_tenths             = -1;
        read("heating-disabled");
    });
    run("hydronic_status", [] {
        hydronic_report = {};
        flow_min_tenths = 65;
        for (bool dated : {false, true}) {
            auto& o                         = hydronic_report.observation;
            o.confirmed                     = dated;
            o.dated                         = dated;
            o.totals.first_evidence_unix_us = dated ? 2000000000000000 : -1;
            o.totals.observed_us            = 14500001;
            o.totals.samples                = 2;
            o.totals.spread                 = {6500, 3000, 3500};
            auto req                        = request();
            check(invoke(req, "/status", daik::h_status) == ESP_OK, "water-circuit status failed");
            successful(req);
            check(req.response.find("\"min_l_min\":6.5") != std::string::npos,
                  "legacy flow minimum changed");
            check(req.response.find(dated ? "\"observed_s\":14.500001" : "\"samples\":null") !=
                      std::string::npos,
                  "water-circuit coverage must depend on dated evidence");
            check(req.response.find(
                      dated ? "\"spread_k\":{\"min\":3,\"mean\":3.25,\"max\":3.5}"
                            : "\"spread_k\":{\"min\":null,\"mean\":null,\"max\":null}") !=
                      std::string::npos,
                  "water spread must use the same known sample population");
            check(req.response.find(
                      "\"pump_command_pct\":{\"min\":null,\"mean\":null,\"max\":null}") !=
                      std::string::npos,
                  "unreadable optional command must remain null");
            check(req.response.find("\"secondary_supply\":null") != std::string::npos,
                  "an unqualified secondary circuit must remain null");
            check(req.response.find(dated ? "\"water_agreement\":{\"method\":2,"
                                          : "\"water_agreement\":null") != std::string::npos,
                  "water agreement object must stay gated on confirmed observation");
            if (dated) emit(req, "secondary-unavailable");
        }
        {
            auto& o                                    = hydronic_report.observation;
            o.confirmed                                = true;
            o.dated                                    = false;
            o.totals.first_evidence_unix_us            = -1;
            o.totals.r1_r4_qualified_us                = 35000001;
            o.totals.r1_r4_windows                     = 1;
            o.totals.r1_r4_samples                     = 2;
            o.totals.r1_r4                             = {-500, -300, -100};
            hydronic_report.current                    = true;
            hydronic_report.agree_reason               = daik::logic::AgreementReason::Settling;
            hydronic_report.agree_settling_remaining_s = 420;
            hydronic_report.agree_limitations          = daik::logic::AgreementDhwRoute;
            auto req                                   = request();
            check(invoke(req, "/status", daik::h_status) == ESP_OK,
                  "undated agreement settling status failed");
            successful(req);
            const size_t agree_pos = req.response.find("\"water_agreement\":{");
            check(agree_pos != std::string::npos &&
                      req.response.find("\"reason\":\"settling\"", agree_pos) !=
                          std::string::npos &&
                      req.response.find("\"settling_remaining_s\":420", agree_pos) !=
                          std::string::npos &&
                      req.response.find("\"qualified_s\":null", agree_pos) != std::string::npos &&
                      req.response.find("\"delta_k\":{\"min\":null,\"mean\":null,\"max\":null}",
                                        agree_pos) != std::string::npos,
                  "undated water agreement must null totals and ranges while reporting live "
                  "settling");
        }
        auto& o                         = hydronic_report.observation;
        o.confirmed                     = true;
        o.dated                         = true;
        o.totals.first_evidence_unix_us = 2000000000000000;
        o.totals.spread                 = {-3, -2, -1};
        o.totals.agree_limitations =
            daik::logic::AgreementDhwRoute | daik::logic::AgreementR2tUnavailable;
        o.totals.r1_r4_qualified_us                = 35000001;
        o.totals.r1_r4_windows                     = 1;
        o.totals.r1_r4_samples                     = 2;
        o.totals.r1_r4                             = {-500, -300, -100};
        o.totals.r2_r1_qualified_us                = 15000000;
        o.totals.r2_r1_windows                     = 1;
        o.totals.r2_r1_samples                     = 3;
        o.totals.r2_r1                             = {900, 200, 400};
        hydronic_report.current                    = true;
        hydronic_report.secondary                  = {-1750, 15000001, 2, {0x65, 4, 105}};
        hydronic_report.r1_r4_supported            = true;
        hydronic_report.r2_r1_supported            = true;
        hydronic_report.agree_reason               = daik::logic::AgreementReason::None;
        hydronic_report.agree_settling_remaining_s = 0;
        hydronic_report.agree_limitations          = daik::logic::AgreementDhwRoute;
        auto req                                   = request();
        check(invoke(req, "/status", daik::h_status) == ESP_OK,
              "signed water-circuit status failed");
        successful(req);
        check(req.response.find("\"spread_k\":{\"min\":-0.002,\"mean\":-0.002,\"max\":-0.001}") !=
                  std::string::npos,
              "a negative half milli must round away from zero");
        check(req.response.find(
                  "\"secondary_supply\":{\"delta_k\":-0.875,\"duration_s\":15.000001,\"samples\":2,"
                  "\"source\":{\"reg\":101,\"offset\":4,\"conv\":105},\"zone_context\":"
                  "\"unknown\"}") != std::string::npos,
              "the signed secondary comparison must remain a distinct observation");
        emit(req, "secondary-current");
        hydronic_report.current = false;
        auto expired            = request();
        check(invoke(expired, "/status", daik::h_status) == ESP_OK,
              "expired secondary status failed");
        successful(expired);
        check(expired.response.find("\"secondary_supply\":null") != std::string::npos,
              "a stale run must not publish its comparison");
        const size_t expired_agree = expired.response.find("\"water_agreement\":{");
        check(expired_agree != std::string::npos &&
                  expired.response.find("\"current_limitations_mask\":null", expired_agree) !=
                      std::string::npos &&
                  expired.response.find("\"settling_remaining_s\":null", expired_agree) !=
                      std::string::npos,
              "a stale run must null agreement current state while retaining dated totals");
        emit(expired, "secondary-expired");
    });
    run("status_fault_timeline", [] {
        current.diagnostics_enabled = true;
        fault_trace.reset();
        working_figure_x10a      = {};
        working_figure_modbus    = {};
        fault_trace.window_end_s = daik::logic::CHECKUP_FAULT_WINDOW_S;
        fault_trace.unix_s       = 1795000000u;
        fault_trace.boot_s       = 500;
        fault_trace.end_s        = 86390;
        fault_trace.live         = true;
        fault_trace.push(80000, {daik::logic::FaultTraceKind::Normal});
        fault_trace.push(86000,
                         {daik::logic::FaultTraceKind::Error, daik::logic::FaultUnitOrigin::Indoor,
                          daik::logic::fault_code_pack("7H"), daik::logic::fault_aux_subcode(1)});
        fault_trace.push(86025, {daik::logic::FaultTraceKind::Normal});
        fault_trace_present = true;

        auto req = request();
        check(invoke(req, "/status", daik::h_status) == ESP_OK, "status fault unredacted failed");
        successful(req);
        check(req.response.find("\"latest\":{\"code\":\"7H-01\",\"base_code\":\"7H\","
                                "\"state\":\"fault\",\"subcode\":1,\"unit\":\"indoor\","
                                "\"ongoing\":false,\"stop_unknown\":false") != std::string::npos &&
                  req.response.find("\"start_unix_s\":1794999600,\"end_unix_s\":1794999625") !=
                      std::string::npos &&
                  req.response.find("\"timeline\":{\"unix_s\":1795000000,"
                                    "\"window_end_s\":86400,\"observed_end_s\":86390") !=
                      std::string::npos,
              "unredacted /status missing fault latest or timeline");

        req = request();
        check(invoke(req, "/status?redact=1", daik::h_status) == ESP_OK,
              "status fault redacted failed");
        successful(req);
        check(req.response.find("\"latest\":{\"code\":\"7H-01\"") != std::string::npos &&
                  req.response.find("\"start_unix_s\"") == std::string::npos &&
                  req.response.find("\"end_unix_s\"") == std::string::npos &&
                  req.response.find("\"timeline\":{\"unix_s\":1795000000") == std::string::npos,
              "redacted /status leaked fault timeline or wall timestamps");

        fail_trace_snapshot = true;
        req                 = request();
        const esp_err_t rc  = invoke(req, "/status", daik::h_status);
        fail_trace_snapshot = false;
        check(rc == ESP_OK, "fault trace OOM fallback must degrade cleanly without 500");
        successful(req);
        check(req.response.find("\"latest\":{\"code\":\"7H-01\"") != std::string::npos,
              "fault trace OOM fallback lost latest summary");
    });
    run("status_cycling_run_contexts", [] {
        current.diagnostics_enabled = true;
        current.diagnostics_source  = daik::DiagnosticsSource::X10a;
        checkup_x10a_has_data       = true;
        cycling_trace.reset();
        cycling_trace.unix_s       = 1795000000u;
        cycling_trace.window_end_s = daik::logic::CHECKUP_WINDOW_S;
        cycling_trace.end_s        = 86390;
        cycling_trace.boot_s       = 200;
        cycling_trace.live         = true;
        cycling_trace.push(86000, daik::logic::CheckupCyclingTrace::Heat);
        auto& dhw        = dhw_timelines[0];
        dhw.epoch        = 29;
        dhw.window_end_s = dhw.observed_end_s = 86390;
        dhw.observed = dhw.live = true;
        dhw.count               = 1;
        dhw.windows[0]          = {82000, 85600, 12, 3600, false, false};
        cycling_run_contexts.reset();
        cycling_run_contexts.flow_typical_tenths = 176;
        auto& e                                  = cycling_run_contexts.entries[0];
        e                                        = daik::logic::cycling_run_context_empty();
        e.start_s                                = 86000;
        e.stop_s                                 = 86168;
        e.start_lwt_tenths                       = 284;
        e.start_tgt_tenths                       = 320;
        e.stop_lwt_tenths                        = 351;
        e.stop_rwt_tenths                        = 336;
        e.stop_tgt_tenths                        = 320;
        e.flow_tenths                            = 82;
        e.flow_typical_tenths                    = 158;
        e.outdoor_tenths                         = 64;
        e.min_rps_tenths                         = 180;
        e.mode       = static_cast<uint8_t>(daik::logic::CyclingRunMode::Space);
        e.start_kind = static_cast<uint8_t>(daik::logic::CyclingStartKind::CooldownRestart);
        e.stop_kind  = static_cast<uint8_t>(daik::logic::CyclingStopKind::LowRpsAboveTarget);
        e.flags      = daik::logic::RUN_CTX_F_STOPPED | daik::logic::RUN_CTX_F_LOW_RPS_ABOVE_TGT |
                  daik::logic::RUN_CTX_F_FINALIZED | daik::logic::RUN_CTX_F_RESTORED;
        cycling_run_contexts.count   = 1;
        cycling_run_contexts_present = true;

        auto req = request();
        check(invoke(req, "/status", daik::h_status) == ESP_OK, "run_contexts unredacted failed");
        successful(req);
        emit(req, "status-cycling-run-contexts");
        check(checkup_wire(req, "dhw_loss").find("\"epoch\":29,") != std::string_view::npos,
              "status dropped DHW detail when a cycling run context is available");
        check(req.response.find("\"flow_typical_l_min\":17.6,\"run_contexts\":[{\"at\":86000,"
                                "\"mode\":\"space\",\"start_kind\":\"cooldown_restart\","
                                "\"stop\":86168,\"stop_kind\":\"low_rps_above_target\","
                                "\"start_lwt_c\":28.4,\"start_target_c\":32.0,\"lwt_c\":35.1,"
                                "\"rwt_c\":33.6,\"target_c\":32.0,\"flow_l_min\":8.2,"
                                "\"outdoor_c\":6.4,\"min_rps\":18.0,"
                                "\"low_rps_above_target\":true,\"flow_reference_fixed\":true,"
                                "\"flow_typical_l_min\":15.8,\"restored\":true}]") !=
                  std::string::npos,
              "status payload missing or malformed cycling run_contexts");

        req = request();
        check(invoke(req, "/status?redact=1", daik::h_status) == ESP_OK,
              "run_contexts redacted failed");
        successful(req);
        check(req.response.find("\"run_contexts\"") == std::string::npos &&
                  req.response.find("\"flow_typical_l_min\"") == std::string::npos &&
                  checkup_wire(req, "dhw_loss").find("\"timeline\":") == std::string_view::npos,
              "redacted /status leaked DHW detail or cycling run contexts");

        current.mb_host            = "192.0.2.50";
        current.diagnostics_source = daik::DiagnosticsSource::Modbus;
        checkup_modbus_has_data    = true;
        req                        = request();
        check(invoke(req, "/status", daik::h_status) == ESP_OK, "modbus run_contexts failed");
        successful(req);
        check(req.response.find("\"run_contexts\"") == std::string::npos &&
                  req.response.find("\"flow_typical_l_min\"") == std::string::npos,
              "modbus /status leaked X10A cycling run_contexts");
    });
    run("status_ota_brief", [] {
        ota             = false;
        ota_brief_busy  = false;
        ota_brief_state = "idle";
        auto req        = request();
        check(invoke(req, "/status", daik::h_status) == ESP_OK, "idle status ota brief failed");
        successful(req);
        check(req.response.find(
                  "\"ota\":{\"channel\":\"release\",\"busy\":false,\"state\":\"idle\"}") !=
                      std::string::npos ||
                  req.response.find(
                      "\"ota\":{\"channel\":\"dev\",\"busy\":false,\"state\":\"idle\"}") !=
                      std::string::npos,
              "idle /status missing expected ota brief fields");

        ota_brief_busy  = true;
        ota_brief_state = "checking";
        req             = request();
        check(invoke(req, "/status", daik::h_status) == ESP_OK, "busy status ota brief failed");
        successful(req);
        check(req.response.find("\"busy\":true,\"state\":\"checking\"") != std::string::npos,
              "busy /status missing expected ota brief fields");

        ota_brief_busy  = false;
        ota_brief_state = "";
        req             = request();
        check(invoke(req, "/status", daik::h_status) == ESP_OK, "empty-state ota brief failed");
        successful(req);
        check(req.response.find("\"busy\":false,\"state\":\"idle\"") != std::string::npos,
              "empty ota_brief.state did not fall back to idle");

        ota_brief_busy  = false;
        ota_brief_state = "idle";
    });
    check(count > 0, "unknown oracle");
    std::printf("PASS total=%u\n", count);
}
