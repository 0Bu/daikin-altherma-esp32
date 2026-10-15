// Full production configuration/OTA HTTP TUs with real cJSON, ingress and field validators.
// SDK/network/runtime services are recording adapters; persistence uses the accepted production
// config_save_transaction over atomic recording entries, never a private commit algorithm.
#include "sdk.hpp"
#include <cerrno>
#include <cstdio>
#include <cstdlib>
#include <initializer_list>
#include <map>
#include <new>
#include <string_view>
#include <vector>
#define socket(...) config_fixture_socket(__VA_ARGS__)
#define connect(...) config_fixture_connect(__VA_ARGS__)
#define select(...) config_fixture_select(__VA_ARGS__)
#define getsockopt(...) config_fixture_getsockopt(__VA_ARGS__)
#define close(...) config_fixture_close(__VA_ARGS__)
#define fcntl(...) config_fixture_fcntl(__VA_ARGS__)
#define getaddrinfo(...) config_fixture_getaddrinfo(__VA_ARGS__)
#define freeaddrinfo(...) config_fixture_freeaddrinfo(__VA_ARGS__)
#ifndef CONFIG_HTTP_PRODUCTION_SOURCE
#error Bind the full production configuration translation unit
#endif
#include CONFIG_HTTP_PRODUCTION_SOURCE
#undef socket
#undef connect
#undef select
#undef getsockopt
#undef close
#undef fcntl
#undef getaddrinfo
#undef freeaddrinfo
#include OTA_HTTP_PRODUCTION_SOURCE

namespace fixture {
daik::Config         current;
std::vector<uint8_t> service, link;
const char*          oracle = "initial";
unsigned             checks = 0, saves = 0, service_writes = 0, link_writes = 0, config_reads = 0;
unsigned             reboots = 0, delays = 0, runtime_changes = 0, env_probes = 0, body_reads = 0;
unsigned mqtt_inits = 0, mqtt_starts = 0, mqtt_stops = 0, mqtt_destroys = 0, semaphore_deletes = 0;
unsigned dns_calls = 0, socket_calls = 0, socket_closes = 0, weather_commits = 0;
unsigned post_write_allocations = 0, stale_attempts = 0, save_fault = 0;

unsigned detection_writes = 0, link_snapshot_reads = 0, restart_guard_calls = 0;
bool     detect_before_service_save = false, reset_latched = false, latch_during_delay = false;
bool     restart_guard_after_delay = false;
int      detected_rx = -1, detected_tx = -1;

daik::ConfigSaveOutcome last_save_outcome;

size_t live_arrays = 0, body_capacity = 0;
bool   fail_next_array = false;

bool   tracking = false, durable_started = false, network = true, dns_ok = true, tcp_ok = true;
bool   semaphore_ok = true, mqtt_init_ok = true, mqtt_connected = true, mqtt_error = false;
bool   mqtt_register_ok = true, mqtt_start_ok = true, mqtt_wait_ok = true, semaphore_given = false;
bool   proof_ok = true, weather_admission = true, refresh_ok = true;
size_t largest_block            = 65536;
daik::Env3ProbeResult env_probe = daik::Env3ProbeResult::Ok;
daik::Env3Status      env_status;
void (*mqtt_callback)(void*, esp_event_base_t, int32_t, void*) = nullptr;
void*                    mqtt_context                          = nullptr;
int                      mqtt_token = 1, semaphore_token = 1;
esp_mqtt_client_config_t mqtt_config;
unsigned                 ota_calls     = 0;
bool                     ota_downgrade = false;
// esp_random() adapter: the value the next draw returns and how often the TU drew one, plus the
// generation the handler handed to the live checkup producer.
uint32_t random_value = 0x10203040U, runtime_generation = 0;
unsigned random_calls = 0, runtime_generation_calls = 0;

[[noreturn]] void fail(const char* reason) {
    std::fprintf(stderr, "FAIL oracle=%s: %s\n", oracle, reason);
    std::exit(1);
}
void check(bool valid, const char* reason) {
    ++checks;
    if (!valid) fail(reason);
}
uint32_t random_draw() {
    ++random_calls;
    return random_value;
}
void checkup_generation(uint32_t generation) {
    ++runtime_changes;
    ++runtime_generation_calls;
    runtime_generation = generation;
}
struct Store {
    bool detection = false;
    int  write_blob(const char* key, const uint8_t* bytes, size_t size) {
        const bool is_service = std::strcmp(key, "cfg") == 0;
        if (detection) {
            if (is_service) fail("detection wrote the HTTP service domain");
            ++detection_writes;
        } else if (is_service)
            ++service_writes;
        else
            ++link_writes;
        if (reset_latched) return ESP_FAIL;
        if (save_fault == (is_service ? 1U : 2U)) return ESP_FAIL;
        auto& target = is_service ? service : link;
        target.assign(bytes, bytes + size); // capacities were reserved before request execution
        // A detection cache commit is independent of the endpoint's first durable write. Its
        // transaction may publish while HTTP is still staging its own requested successor.
        if (!detection) durable_started = true;
        return ESP_OK;
    }
};
void reset() {
    tracking = durable_started = false;
    current                    = daik::Config{};
    current.rx_pin             = 44;
    current.tx_pin             = 43;
    current.profile            = "generic";
    current.board_user_set     = false;
    current.board_preset_id    = daik::BoardPresetId::Custom;
    current.led_gpio = current.btn_gpio    = -1;
    current.env3_enabled                   = false;
    current.wifi_ssid                      = "test-wifi";
    current.wifi_pass                      = "fixture-old-pass";
    current.mqtt_uri                       = "mqtts://old.invalid";
    current.mqtt_user                      = "old-user";
    current.mqtt_pass                      = "old-password";
    current.mqtt_base                      = "fixture-old-base";
    current.syslog_host                    = "old.invalid";
    current.syslog_port                    = 514;
    current.ntp_server                     = "old.pool.invalid";
    current.mb_host                        = "old-hh.invalid";
    current.mb_port                        = 502;
    current.mb_unit_id                     = 1;
    current.mb_discovery_done              = true;
    current.ref_temp_topic                 = "fixture/old-room";
    current.ref_temp_path                  = "temperature";
    current.ref_temp_fixed_setpoint_tenths = 200;
    current.circulation_topic              = "fixture/old-circ";
    current.circulation_power_path         = "apower";
    current.circulation_time_path          = "timestamp";
    current.weather_enabled                = true;
    current.weather_latitude_e6            = 0;
    current.weather_longitude_e6           = 0;
    current.diagnostics_enabled            = true;
    current.diagnostics_generation         = 9;
    current.ota_channel                    = daik::OtaChannel::Release;
    current.ui_lang                        = daik::UiLang::Auto;
    service = daik::config_blob_serialize(daik::config_blob_from(current));
    link    = daik::link_blob_serialize({current.rx_pin, current.tx_pin,
                                         static_cast<char>(current.proto), current.x10a_identity_fp});
    service.reserve(16384);
    link.reserve(128);
    saves = service_writes = link_writes = config_reads = reboots = delays = runtime_changes = 0;
    env_probes = body_reads = mqtt_inits = mqtt_starts = mqtt_stops = mqtt_destroys = 0;
    semaphore_deletes = dns_calls = socket_calls = socket_closes = weather_commits = 0;
    post_write_allocations = stale_attempts = save_fault = 0;
    detection_writes = link_snapshot_reads = restart_guard_calls = 0;
    detect_before_service_save = reset_latched = latch_during_delay = false;
    restart_guard_after_delay                                       = false;
    detected_rx = detected_tx = -1;
    last_save_outcome         = {};
    body_capacity             = 0;
    fail_next_array           = false;
    network = dns_ok = tcp_ok = semaphore_ok = mqtt_init_ok = mqtt_connected = true;
    mqtt_register_ok = mqtt_start_ok = mqtt_wait_ok = proof_ok = weather_admission = refresh_ok =
        true;
    mqtt_error = semaphore_given = false;
    largest_block                = 65536;
    env_probe                    = daik::Env3ProbeResult::Ok;
    env_status                   = {};
    env_status.connected = env_status.fresh = true;
    mqtt_callback                           = nullptr;
    mqtt_context                            = nullptr;
    ota_calls                               = 0;
    ota_downgrade                           = false;
    random_value                            = 0x10203040U;
    random_calls = runtime_generation = runtime_generation_calls = 0;
}
using Handler = esp_err_t (*)(httpd_req_t*);
struct Route {
    const char* name;
    Handler     handler;
    const char* valid;
    bool        reboot;
};
const Route routes[] = {
    {"wifi", daik::set_wifi, R"({"ssid":"new-net","pass":"fixture-pass"})", true},
    {"mqtt", daik::set_mqtt,
     R"({"broker":"mqtts://fixture.invalid","user":"new-user","pass":"new-pass","base":"fixture-new-base"})",
     true},
    {"ref", daik::set_ref_temp,
     R"({"name":"Room","topic":"fixture/new-room","temperature_path":"room.tC","fixed_setpoint_c":20.1,"max_age_s":600})",
     false},
    {"circ", daik::set_circulation,
     R"({"name":"Pump","topic":"fixture/new-circ","power_path":"apower","timestamp_path":"timestamp","test_proof":83})",
     false},
    {"diagnostics", daik::set_diagnostics, R"({"enabled":false})", false},
    {"hp", daik::set_hp, R"({"rx":9,"tx":10})", false},
    {"homehub", daik::set_hp, R"({"mb_host":"fixture-hh.invalid","mb_port":1502,"mb_unit_id":2})",
     false},
    {"syslog", daik::set_syslog, R"({"host":"collector.invalid","port":1514})", true},
    {"ntp", daik::set_ntp, R"({"server":"new.pool.invalid"})", true},
    {"weather", daik::set_weather, R"({"latitude":"12.345678","longitude":"23.456789"})", false},
    {"board", daik::set_board,
     R"({"preset_id":"custom","led_gpio":21,"led_type":0,"btn_gpio":-1,"env3_enabled":false})",
     true},
    {"env3", daik::set_env3, R"({"enabled":true,"sda":2,"scl":1})", true},
    {"ota", daik::set_ota, R"({"channel":"dev"})", false},
    {"lang", daik::set_lang, R"({"lang":"de"})", false},
};
const Route& route(const char* name) {
    for (const auto& candidate : routes)
        if (std::strcmp(name, candidate.name) == 0) return candidate;
    fail("unknown fixture route");
}
void prepare(const Route& candidate) {
    reset();
    if (std::strcmp(candidate.name, "env3") == 0) {
        current.board_user_set  = true;
        current.board_preset_id = daik::BoardPresetId::M5StackAtomS3Lite;
        service                 = daik::config_blob_serialize(daik::config_blob_from(current));
        service.reserve(16384);
    }
}
httpd_req_t invoke(Handler handler, std::string body, bool fail_body = false) {
    httpd_req_t request;
    request.body        = std::move(body);
    request.body_failed = fail_body;
    request.response.reserve(8192);
    request.status.reserve(128);
    request.content_type.reserve(128);
    tracking               = true;
    const esp_err_t result = handler(&request);
    tracking               = false;
    check(result == ESP_OK, "actual configuration handler failed to return its HTTP response");
    check(post_write_allocations == 0, "endpoint allocated after first successful durable write");
    return request;
}
std::string changed(const char* original, const char* field, const char* value) {
    daik::JsonGuard object(daik::json_parse_document(original));
    check(bool(object), "fixture valid body is not an object");
    cJSON* replacement = cJSON_Parse(value);
    check(replacement != nullptr, "fixture replacement is not valid JSON");
    if (cJSON_HasObjectItem(object, field))
        cJSON_ReplaceItemInObject(object, field, replacement);
    else
        cJSON_AddItemToObject(object, field, replacement);
    char* encoded = cJSON_PrintUnformatted(object);
    check(encoded != nullptr, "fixture JSON serializer failed");
    std::string body(encoded);
    cJSON_free(encoded);
    return body;
}
void rejection(const Route& candidate, const std::string& body,
               const char* status = "400 Bad Request", bool strict_no_work = false) {
    const auto old_service = service, old_link = link;
    const auto before  = daik::config_blob_serialize(daik::config_blob_from(current));
    const auto request = invoke(candidate.handler, body);
    if (request.status != status)
        std::fprintf(stderr, "fixture route=%s body=%s observed=%s expected=%s\n", candidate.name,
                     body.c_str(), request.status.c_str(), status);
    check(request.status == status, "invalid request is not the required HTTP rejection");
    daik::JsonGuard response(daik::json_parse_document(request.response));
    check(bool(response) && cJSON_IsFalse(cJSON_GetObjectItem(response, "ok")) &&
              cJSON_IsString(cJSON_GetObjectItem(response, "error")),
          "rejection has no stable JSON error");
    check(service == old_service && link == old_link &&
              daik::config_blob_serialize(daik::config_blob_from(current)) == before,
          "rejected request changed durable entries or live services");
    check(saves == 0 && reboots == 0 && runtime_changes == 0 && weather_commits == 0,
          "invalid request reached save/reboot/runtime mutation");
    if (strict_no_work)
        check(config_reads == 0 && env_probes == 0 && dns_calls == 0 && mqtt_inits == 0,
              "mistyped request reached snapshot, hardware or network preflight");
}
void success(const Route& candidate) {
    prepare(candidate);
    const auto response = invoke(candidate.handler, candidate.valid);
    check(response.status == "200 OK" && saves == 1, "valid setter does not save exactly once");
    daik::JsonGuard document(daik::json_parse_document(response.response));
    check(bool(document) && cJSON_IsTrue(cJSON_GetObjectItem(document, "ok")),
          "valid setter is not ok");
    check(reboots == static_cast<unsigned>(candidate.reboot), "valid setter reboot policy changed");
    check(delays == reboots, "only a reboot waits its 400 ms response window");
    const bool owns_link = std::strcmp(candidate.name, "hp") == 0;
    check(service_writes == (owns_link ? 0U : 1U) && link_writes == 1,
          "setter durability domains disagree with accepted CFG-03");
    if (std::strcmp(candidate.name, "mqtt") == 0)
        check(mqtt_inits == 1 && mqtt_starts == 1 && mqtt_stops == 1 && mqtt_destroys == 1 &&
                  semaphore_deletes == 1 && dns_calls == 1 && socket_closes == 1,
              "MQTT preflight resources did not complete before persistence");
}
} // namespace fixture

void* operator new(size_t size) {
    if (fixture::tracking && fixture::durable_started) {
        ++fixture::post_write_allocations;
        throw std::bad_alloc();
    }
    if (void* memory = std::malloc(size ? size : 1)) return memory;
    throw std::bad_alloc();
}
void* operator new[](size_t size) {
    if (fixture::fail_next_array) {
        fixture::fail_next_array = false;
        throw std::bad_alloc();
    }
    void* memory = ::operator new(size);
    ++fixture::live_arrays;
    return memory;
}
void operator delete(void* memory) noexcept { std::free(memory); }
void operator delete[](void* memory) noexcept {
    if (memory) --fixture::live_arrays;
    std::free(memory);
}
void operator delete(void* memory, size_t) noexcept { std::free(memory); }
void operator delete[](void* memory, size_t) noexcept { ::operator delete[](memory); }

namespace daik {
bool hp_probe_run(uint8_t, HpProbeReply&, int) {
    fixture::fail("malformed query reached a physical probe");
}
Config config() {
    ++fixture::config_reads;
    return fixture::current;
}
ConfigLinkSnapshot config_link_snapshot() {
    ++fixture::link_snapshot_reads;
    return {fixture::current.proto, fixture::current.rx_pin, fixture::current.tx_pin};
}
bool config_save(const Config& requested) {
    ++fixture::saves;
    if (fixture::detect_before_service_save) {
        fixture::detect_before_service_save = false;
        fixture::Store detected_store{true};
        bool           link_saved         = false;
        uint32_t       committed_revision = 0;
        // Execute the real detection transaction at the boundary between the handler's snapshot
        // validation and its real service transaction, instead of fabricating a save failure.
        const bool committed = config_commit_detected_link_transaction(
            fixture::current, fixture::current.runtime_revision, fixture::detected_rx,
            fixture::detected_tx, Protocol::I, 0x51c07U, detected_store, link_saved,
            committed_revision);
        if (!committed || !link_saved || committed_revision != fixture::current.runtime_revision)
            fixture::fail("prepared concurrent detection did not commit its real transaction");
    }
    fixture::Store store;
    fixture::last_save_outcome = config_save_transaction(fixture::current, requested, false, store);
    return fixture::last_save_outcome.result == ConfigSaveResult::Saved;
}
ConfigSaveResult config_save_link(const Config& requested) {
    ++fixture::saves;
    if (fixture::stale_attempts) {
        --fixture::stale_attempts;
        return ConfigSaveResult::Stale;
    }
    fixture::Store store;
    return config_save_transaction(fixture::current, requested, true, store).result;
}
bool nvs_restart_held_by_factory_reset(const char* who) {
    if (std::strcmp(who, "config") != 0) fixture::fail("restart guard has wrong caller identity");
    ++fixture::restart_guard_calls;
    fixture::restart_guard_after_delay = fixture::delays != 0;
    return fixture::reset_latched;
}
bool         config_diagnostics_enabled() { return fixture::current.diagnostics_enabled; }
bool         hw_octal_spi() { return false; }
ReservedPins net_eth_reserved_pins() { return {}; }
bool         net_is_up() { return fixture::network; }
size_t       heap_largest_internal_block() { return fixture::largest_block; }
void         diag_printf(const char*, ...) {}
void         mqtt_reference_reconfigure() { ++fixture::runtime_changes; }
void         mqtt_circulation_reconfigure(bool) { ++fixture::runtime_changes; }
void         mqtt_request_weather_cleanup() { ++fixture::runtime_changes; }
void         mqtt_request_modbus_cleanup() { ++fixture::runtime_changes; }
void         checkup_set_diagnostics(bool, uint32_t g) { fixture::checkup_generation(g); }
void         checkup_reset() { ++fixture::runtime_changes; }
void         checkup_reset_on_detect(const char*, uint32_t) { ++fixture::runtime_changes; }
void         dwell_reset() { ++fixture::runtime_changes; }
void         dwell_reset_on_detect(const char*) { ++fixture::runtime_changes; }
void         history_reset() { ++fixture::runtime_changes; }
void         history_reset_on_detect(uint32_t) { ++fixture::runtime_changes; }
uint32_t     history_x10a_identity(const char* profile, int32_t rx, int32_t tx, char proto) {
    return logic::history_x10a_target_fingerprint(profile, rx, tx, proto);
}
void history_checkup_reset() { ++fixture::runtime_changes; }
void history_circulation_reset() { ++fixture::runtime_changes; }
void history_modbus_reset(uint32_t) noexcept { ++fixture::runtime_changes; }
void hp_poll_reconfigure() { ++fixture::runtime_changes; }
void mb_reconfigure(bool) noexcept { ++fixture::runtime_changes; }
bool mb_discover_homehub(std::string& found) {
    found = "192.0.2.12";
    return true;
}
void            config_reset_detection() { ++fixture::runtime_changes; }
Env3Status      env3_status() { return fixture::env_status; }
Env3ProbeResult env3_probe(int, int) {
    ++fixture::env_probes;
    return fixture::env_probe;
}
bool mqtt_circulation_test_proof_valid(uint32_t proof, const CirculationSourceTestConfig&) {
    return fixture::proof_ok && proof == 83;
}
CirculationSourceTestResult mqtt_circulation_test(const CirculationSourceTestConfig&, uint32_t) {
    CirculationSourceTestResult result;
    result.passed  = true;
    result.proof   = 83;
    result.power_w = 5;
    return result;
}
WeatherSourceChange::WeatherSourceChange(bool configured, bool diagnostics) {
    configured_          = configured;
    diagnostics_enabled_ = diagnostics;
    held_                = fixture::weather_admission;
}
WeatherSourceChange::~WeatherSourceChange() noexcept = default;
void WeatherSourceChange::commit() noexcept { ++fixture::weather_commits; }
void weather_forecast_reconfigure() { ++fixture::runtime_changes; }
bool weather_forecast_request_refresh(uint64_t& token) noexcept {
    if (!fixture::refresh_ok) return false;
    token = 73;
    return true;
}
esp_err_t http_send_json(httpd_req_t* request, const char* body) {
    request->content_type = "application/json";
    request->response     = body;
    return ESP_OK;
}
int http_read_body(httpd_req_t* request, char* buffer, size_t capacity) {
    ++fixture::body_reads;
    fixture::body_capacity = capacity;
    if (request->body_failed || request->body.size() >= capacity) return -1;
    std::memcpy(buffer, request->body.data(), request->body.size());
    buffer[request->body.size()] = '\0';
    return static_cast<int>(request->body.size());
}
uint32_t ota_update_async(uint32_t after, const char*, const char*, const char*, bool downgrade) {
    ++fixture::ota_calls;
    fixture::ota_downgrade = downgrade;
    return after + 1;
}
} // namespace daik

void vTaskDelay(TickType_t delay) {
    fixture::check(delay == 400, "reboot delay must remain bounded");
    ++fixture::delays;
    if (fixture::latch_during_delay) fixture::reset_latched = true;
}
void              esp_restart() { ++fixture::reboots; }
uint32_t          esp_random() { return fixture::random_draw(); }
SemaphoreHandle_t xSemaphoreCreateBinary() {
    return fixture::semaphore_ok ? &fixture::semaphore_token : nullptr;
}
BaseType_t xSemaphoreTake(SemaphoreHandle_t, TickType_t delay) {
    fixture::check(delay == 5000, "MQTT event wait is bounded");
    return fixture::mqtt_wait_ok && fixture::semaphore_given ? pdTRUE : pdFALSE;
}
BaseType_t xSemaphoreGive(SemaphoreHandle_t) {
    fixture::semaphore_given = true;
    return pdTRUE;
}
void                     vSemaphoreDelete(SemaphoreHandle_t) { ++fixture::semaphore_deletes; }
esp_err_t                esp_crt_bundle_attach(void*) { return ESP_OK; }
esp_mqtt_client_handle_t esp_mqtt_client_init(const esp_mqtt_client_config_t* config) {
    ++fixture::mqtt_inits;
    fixture::mqtt_config = *config;
    return fixture::mqtt_init_ok ? &fixture::mqtt_token : nullptr;
}
esp_err_t esp_mqtt_client_register_event(esp_mqtt_client_handle_t, int,
                                         void (*handler)(void*, esp_event_base_t, int32_t, void*),
                                         void* context) {
    fixture::mqtt_callback = handler;
    fixture::mqtt_context  = context;
    return fixture::mqtt_register_ok ? ESP_OK : ESP_FAIL;
}
esp_err_t esp_mqtt_client_start(esp_mqtt_client_handle_t) {
    ++fixture::mqtt_starts;
    if (!fixture::mqtt_start_ok) return ESP_FAIL;
    if (fixture::mqtt_error) {
        esp_mqtt_error_codes_t error;
        error.connect_return_code = MQTT_CONNECTION_REFUSE_BAD_USERNAME;
        esp_mqtt_event_t event{&error};
        fixture::mqtt_callback(fixture::mqtt_context, "MQTT", MQTT_EVENT_ERROR, &event);
    } else
        fixture::mqtt_callback(
            fixture::mqtt_context, "MQTT",
            fixture::mqtt_connected ? MQTT_EVENT_CONNECTED : MQTT_EVENT_DISCONNECTED, nullptr);
    return ESP_OK;
}
esp_err_t esp_mqtt_client_stop(esp_mqtt_client_handle_t) {
    ++fixture::mqtt_stops;
    return ESP_OK;
}
esp_err_t esp_mqtt_client_destroy(esp_mqtt_client_handle_t) {
    ++fixture::mqtt_destroys;
    return ESP_OK;
}
int config_fixture_getaddrinfo(const char*, const char*, const addrinfo*, addrinfo** out) {
    ++fixture::dns_calls;
    if (!fixture::dns_ok) {
        *out = nullptr;
        return EAI_FAIL;
    }
    static sockaddr_in address{};
    static addrinfo    result{};
    result.ai_addr    = reinterpret_cast<sockaddr*>(&address);
    result.ai_addrlen = sizeof(address);
    *out              = &result;
    return 0;
}
void config_fixture_freeaddrinfo(addrinfo*) {}
int  config_fixture_socket(int, int, int) {
    ++fixture::socket_calls;
    return 4;
}
int config_fixture_connect(int, const sockaddr*, socklen_t) {
    errno = ECONNREFUSED;
    return fixture::tcp_ok ? 0 : -1;
}
int config_fixture_select(int, fd_set*, fd_set*, fd_set*, timeval*) { return 0; }
int config_fixture_getsockopt(int, int, int, void*, socklen_t*) { return -1; }
int config_fixture_close(int) {
    ++fixture::socket_closes;
    return 0;
}
int       config_fixture_fcntl(int, int, ...) { return 0; }
size_t    httpd_req_get_url_query_len(httpd_req_t* request) { return request->query.size(); }
esp_err_t httpd_req_get_url_query_str(httpd_req_t* request, char* out, size_t capacity) {
    if (request->query.empty()) return ESP_ERR_NOT_FOUND;
    if (request->query.size() >= capacity) return ESP_ERR_HTTPD_RESULT_TRUNC;
    std::memcpy(out, request->query.c_str(), request->query.size() + 1);
    return ESP_OK;
}
esp_err_t httpd_query_key_value(const char* query, const char* key, char* out, size_t capacity) {
    const std::string_view whole(query);
    size_t                 offset = 0;
    while (offset < whole.size()) {
        const size_t end = whole.find('&', offset);
        const auto part  = whole.substr(offset, end == std::string_view::npos ? end : end - offset);
        const size_t equals = part.find('=');
        if (part.substr(0, equals) == key) {
            const auto value =
                equals == std::string_view::npos ? std::string_view{} : part.substr(equals + 1);
            if (value.size() >= capacity) return ESP_ERR_HTTPD_RESULT_TRUNC;
            std::memcpy(out, value.data(), value.size());
            out[value.size()] = '\0';
            return ESP_OK;
        }
        if (end == std::string_view::npos) break;
        offset = end + 1;
    }
    return ESP_ERR_NOT_FOUND;
}
size_t    httpd_req_get_hdr_value_len(httpd_req_t*, const char*) { return 0; }
esp_err_t httpd_req_get_hdr_value_str(httpd_req_t*, const char*, char*, size_t) {
    return ESP_ERR_NOT_FOUND;
}
esp_err_t httpd_resp_send_err(httpd_req_t* request, int, const char* text) {
    request->response = text;
    return ESP_OK;
}
esp_err_t httpd_resp_send(httpd_req_t* request, const char* bytes, int size) {
    request->response.assign(bytes ? bytes : "", size == HTTPD_RESP_USE_STRLEN
                                                     ? std::strlen(bytes)
                                                     : static_cast<size_t>(size));
    return ESP_OK;
}
esp_err_t httpd_resp_set_hdr(httpd_req_t*, const char*, const char*) { return ESP_OK; }

namespace test {
using namespace fixture;
struct Field {
    const char* route;
    const char* key;
    char        type;
};
const Field fields[] = {
    {"wifi", "ssid", 's'},
    {"wifi", "pass", 's'},
    {"mqtt", "broker", 's'},
    {"mqtt", "user", 's'},
    {"mqtt", "pass", 's'},
    {"mqtt", "base", 's'},
    {"mqtt", "clear_creds", 'b'},
    {"ref", "name", 's'},
    {"ref", "topic", 's'},
    {"ref", "temperature_path", 's'},
    {"ref", "setpoint_topic", 's'},
    {"ref", "setpoint_path", 's'},
    {"ref", "timestamp_topic", 's'},
    {"ref", "timestamp_path", 's'},
    {"ref", "enabled_path", 's'},
    {"ref", "hvac_mode_path", 's'},
    {"ref", "fixed_setpoint_c", 'n'},
    {"ref", "max_age_s", 'i'},
    {"circ", "name", 's'},
    {"circ", "topic", 's'},
    {"circ", "power_path", 's'},
    {"circ", "timestamp_path", 's'},
    {"circ", "max_age_s", 'i'},
    {"circ", "confirm_s", 'i'},
    {"circ", "test_proof", 'i'},
    {"circ", "on_threshold_w", 'n'},
    {"circ", "off_threshold_w", 'n'},
    {"diagnostics", "enabled", 'b'},
    {"hp", "profile", 's'},
    {"hp", "rx", 'i'},
    {"hp", "tx", 'i'},
    {"homehub", "mb_host", 's'},
    {"homehub", "mb_port", 'i'},
    {"homehub", "mb_unit_id", 'i'},
    {"syslog", "host", 's'},
    {"syslog", "port", 'i'},
    {"ntp", "server", 's'},
    {"weather", "latitude", 's'},
    {"weather", "longitude", 's'},
    {"weather", "refresh", 'b'},
    {"board", "preset_id", 's'},
    {"board", "led_gpio", 'i'},
    {"board", "led_type", 'i'},
    {"board", "led_inverted", 'b'},
    {"board", "btn_gpio", 'i'},
    {"board", "btn_active_low", 'b'},
    {"board", "env3_enabled", 'b'},
    {"board", "env3_sda", 'i'},
    {"board", "env3_scl", 'i'},
    {"env3", "enabled", 'b'},
    {"env3", "sda", 'i'},
    {"env3", "scl", 'i'},
    {"ota", "channel", 's'},
    {"lang", "lang", 's'},
};
void wrong_types() {
    for (const Field& field : fields) {
        const auto& candidate = route(field.route);
        for (const char* value : {"null", "[]", "{}", field.type == 's' ? "false" : "\"wrong\""}) {
            prepare(candidate);
            rejection(candidate, changed(candidate.valid, field.key, value), "400 Bad Request",
                      true);
        }
        if (field.type == 's' || field.type == 'b') {
            prepare(candidate);
            rejection(candidate, changed(candidate.valid, field.key, "1"), "400 Bad Request", true);
        }
    }
}
void integer_fields() {
    for (const Field& field : fields)
        if (field.type == 'i') {
            const auto& candidate = route(field.route);
            for (const char* value : {"1.9", "2147483648", "-2147483649", "1e100", "1e999"}) {
                prepare(candidate);
                // Insert the lexical value without PrintUnformatted rounding infinity back to null.
                const std::string body = std::string("{\"") + field.key + "\":" + value + "}";
                rejection(candidate, body);
            }
        }
}
void valid_setters() {
    for (const auto& candidate : routes) success(candidate);
}
void bounds_and_modes() {
    struct Bound {
        const char* route;
        const char* field;
        const char* value;
    };
    const Bound invalid[] = {
        {"wifi", "ssid", R"("")"},
        {"wifi", "pass", R"("seven12")"},
        {"mqtt", "base", R"("bad/#")"},
        {"mqtt", "broker", R"("mqtt://fixture.invalid")"},
        {"ref", "max_age_s", "9"},
        {"ref", "max_age_s", "3601"},
        {"ref", "fixed_setpoint_c", "4.9"},
        {"ref", "fixed_setpoint_c", "35.1"},
        {"ref", "fixed_setpoint_c", "20.11"},
        {"circ", "power_path", R"("bad path")"},
        {"circ", "timestamp_path", R"("")"},
        {"circ", "max_age_s", "9"},
        {"circ", "max_age_s", "3601"},
        {"circ", "confirm_s", "0"},
        {"circ", "confirm_s", "601"},
        {"circ", "on_threshold_w", "1"},
        {"hp", "profile", R"("unknown-profile")"},
        {"hp", "rx", "10"},
        {"hp", "rx", "49"},
        {"hp", "rx", "0"},
        {"homehub", "mb_port", "0"},
        {"homehub", "mb_port", "65536"},
        {"homehub", "mb_unit_id", "0"},
        {"homehub", "mb_unit_id", "248"},
        {"syslog", "port", "0"},
        {"syslog", "port", "65536"},
        {"weather", "latitude", R"("90.000001")"},
        {"weather", "latitude", R"("-90.000001")"},
        {"weather", "latitude", R"("1e1")"},
        {"weather", "latitude", R"(" 51 ")"},
        {"weather", "latitude", R"("+51")"},
        {"weather", "latitude", R"("51.1234567")"},
        {"weather", "latitude", R"("")"},
        {"weather", "longitude", R"("180.000001")"},
        {"board", "led_gpio", "44"},
        {"board", "led_gpio", "49"},
        {"board", "led_type", "2"},
        {"board", "btn_gpio", "44"},
        {"board", "btn_gpio", "21"},
        {"env3", "sda", "1"},
        {"env3", "sda", "49"},
        {"env3", "scl", "49"},
        {"ota", "channel", R"("DEV")"},
        {"lang", "lang", R"("DE")"},
    };
    for (const auto& bound : invalid) {
        const auto& candidate = route(bound.route);
        prepare(candidate);
        rejection(candidate, changed(candidate.valid, bound.field, bound.value));
    }
    struct Length {
        const char* route;
        const char* field;
        unsigned    size;
    };
    for (const auto& bound :
         {Length{"wifi", "ssid", 33}, Length{"wifi", "pass", 64}, Length{"ref", "name", 49},
          Length{"ref", "topic", 193}, Length{"ref", "temperature_path", 129},
          Length{"homehub", "mb_host", 513}}) {
        const auto& candidate = route(bound.route);
        prepare(candidate);
        const std::string value = "\"" + std::string(bound.size, 'a') + "\"";
        rejection(candidate, changed(candidate.valid, bound.field, value.c_str()));
    }
    for (const unsigned ssid_size : {1U, 32U})
        for (const unsigned password_size : {0U, 8U, 63U}) {
            prepare(route("wifi"));
            const std::string body = "{\"ssid\":\"" + std::string(ssid_size, 'a') +
                                     "\",\"pass\":\"" + std::string(password_size, 'b') + "\"}";
            check(invoke(daik::set_wifi, body).status == "200 OK" &&
                      current.wifi_ssid.size() == ssid_size &&
                      current.wifi_pass.size() == password_size,
                  "WiFi adjacent valid byte boundaries must be accepted exactly");
        }
    prepare(route("mqtt"));
    check(invoke(daik::set_mqtt, R"({"broker":"","clear_creds":true,"base":""})").status ==
                  "200 OK" &&
              current.mqtt_uri.empty() && current.mqtt_user.empty() && current.mqtt_pass.empty() &&
              current.mqtt_base.empty() && mqtt_inits == 0,
          "explicit empty broker/credential clear/base reset must remain valid");
    prepare(route("weather"));
    const auto refresh =
        invoke(daik::set_weather, R"({"latitude":"0","longitude":"0","refresh":true})");
    check(refresh.status == "200 OK" && saves == 0 && runtime_changes == 0,
          "unchanged explicit weather refresh must remain nonpersistent");
    daik::JsonGuard response(daik::json_parse_document(refresh.response));
    const auto      token = cJSON_GetObjectItem(response, "refresh_token");
    check(token && token->valuedouble == 73 &&
              cJSON_IsTrue(cJSON_GetObjectItem(response, "refresh_requested")),
          "weather refresh response must carry its causal token");
    prepare(route("weather"));
    rejection(route("weather"),
              R"({"latitude":"12.345678","longitude":"23.456789","refresh":true})", "409 Conflict");
}
void unchanged() {
    for (const auto& candidate : routes) {
        success(candidate);
        const auto before_service = service, before_link = fixture::link;
        saves = service_writes = link_writes = reboots = delays = runtime_changes =
            weather_commits                                     = 0;
        durable_started                                         = false;
        const auto result = invoke(candidate.handler, candidate.valid);
        check(result.status == "200 OK", "unchanged request must remain successful");
        if (std::strcmp(candidate.name, "wifi") == 0)
            check(saves == 1 && reboots == 1,
                  "unchanged WiFi request deliberately rearms rollback trial");
        else if (std::strcmp(candidate.name, "hp") == 0 ||
                 std::strcmp(candidate.name, "homehub") == 0)
            check(saves == 1 && reboots == 0 && runtime_changes == 0,
                  "unchanged HP patch keeps explicit-save contract without runtime reset");
        else {
            check(saves == 0 && service_writes == 0 && link_writes == 0 && reboots == 0 &&
                      service == before_service && fixture::link == before_link,
                  "unchanged setter wrote or rebooted");
            check(runtime_changes == (std::strcmp(candidate.name, "ref") == 0 ? 1U : 0U),
                  "only unchanged reference mapping deliberately rebinds");
        }
    }
}
void persistence_failure() {
    for (const auto& candidate : routes) {
        prepare(candidate);
        const auto before_service = service, before_link = fixture::link;
        const auto before_ram = daik::config_blob_serialize(daik::config_blob_from(current));
        save_fault            = std::strcmp(candidate.name, "hp") == 0 ? 2 : 1;
        const auto response   = invoke(candidate.handler, candidate.valid);
        check(response.status == "500 Internal Server Error",
              "route-owned failed save must reply HTTP 500");
        daik::JsonGuard document(daik::json_parse_document(response.response));
        check(bool(document) && cJSON_IsFalse(cJSON_GetObjectItem(document, "ok")),
              "failed save must not report ok");
        check(service == before_service && fixture::link == before_link &&
                  daik::config_blob_serialize(daik::config_blob_from(current)) == before_ram,
              "route-owned write failure changed live or durable config");
        check(reboots == 0 && runtime_changes == 0 && weather_commits == 0,
              "failed save rebooted or committed a runtime successor");
    }
    for (const auto& candidate : routes)
        if (std::strcmp(candidate.name, "hp") != 0) {
            prepare(candidate);
            save_fault          = 2;
            const auto response = invoke(candidate.handler, candidate.valid);
            check(response.status == "200 OK" && service_writes == 1 && link_writes == 1,
                  "best-effort link maintenance must not reject committed service change");
        }
}
void request_scratch() {
    struct RequestScope {
        Handler handler;
        size_t  capacity;
    };
    const RequestScope scopes[] = {
        {daik::set_wifi, 512},         {daik::set_mqtt, 512},        {daik::set_ref_temp, 8192},
        {daik::set_circulation, 1280}, {daik::set_diagnostics, 128}, {daik::set_hp, 2048},
        {daik::set_syslog, 512},       {daik::set_ntp, 256},         {daik::set_weather, 256},
        {daik::set_board, 512},        {daik::set_env3, 256},        {daik::set_ota, 128},
        {daik::set_lang, 128},         {daik::hp_query_probe, 192},
    };
    for (const auto& scope : scopes) {
        reset();
        check(live_arrays == 0, "previous request leaked bounded scratch");
        const auto  saved_service = service, saved_link = fixture::link;
        httpd_req_t request;
        request.body = "{}";
        request.response.reserve(8192);
        request.status.reserve(128);
        request.content_type.reserve(128);
        fail_next_array = true;
        bool caught     = false;
        try {
            scope.handler(&request);
        } catch (const std::bad_alloc&) {
            caught = true; // The independently tested common trampoline owns the clean 503.
        }
        fail_next_array = false;
        check(caught && live_arrays == 0 && body_reads == 0,
              "scratch OOM did not propagate before body parsing");
        check(service == saved_service && fixture::link == saved_link && saves == 0 &&
                  reboots == 0 && config_reads == 0 && runtime_changes == 0,
              "scratch OOM reached config, persistence or runtime mutation");
        reset();
        const auto invalid = invoke(scope.handler, "{");
        check(invalid.status == "400 Bad Request" && body_capacity == scope.capacity &&
                  live_arrays == 0 && saves == 0 && runtime_changes == 0,
              "invalid JSON changed capacity, leaked scratch or reached a mutation");
        reset();
        const auto failed_body = invoke(scope.handler, "{}", true);
        check(failed_body.status == "400 Bad Request" && body_capacity == scope.capacity &&
                  live_arrays == 0 && saves == 0 && runtime_changes == 0,
              "body failure changed capacity, leaked scratch or reached a mutation");
    }
}
void ingress() {
    for (const auto& candidate : routes) {
        for (const char* body :
             {"null", "[]", "true", "0", "\"{}\"", "{} {}", "{", R"({"unused":"a\u0000b"})"}) {
            prepare(candidate);
            rejection(candidate, body, "400 Bad Request", true);
        }
        prepare(candidate);
        rejection(candidate, std::string("{\"unused\":\"a\0b\"}", 16), "400 Bad Request", true);
        prepare(candidate);
        const auto response = invoke(candidate.handler, candidate.valid, true);
        check(response.status == "400 Bad Request" && saves == 0 && runtime_changes == 0,
              "body transport rejection reached a mutation");
    }
}
void missing_and_disabled() {
    for (const char* name :
         {"mqtt", "ref", "circ", "syslog", "ntp", "weather", "hp", "board", "env3"}) {
        const auto& candidate = route(name);
        prepare(candidate);
        const auto response = invoke(candidate.handler, "{}");
        check(response.status == "200 OK", "documented missing-field behavior changed");
        if (std::strcmp(name, "mqtt") == 0)
            check(current.mqtt_uri.empty() && current.mqtt_user == "old-user" &&
                      current.mqtt_base == "fixture-old-base",
                  "missing MQTT broker disables while credentials/base remain");
        if (std::strcmp(name, "ref") == 0)
            check(current.ref_temp_topic.empty() && current.ref_temp_path.empty(),
                  "missing room topic disables mapping");
        if (std::strcmp(name, "circ") == 0)
            check(current.circulation_topic.empty(), "missing circulation topic disables mapping");
        if (std::strcmp(name, "syslog") == 0)
            check(current.syslog_host.empty() && current.syslog_port == 514,
                  "missing syslog host disables with default port");
        if (std::strcmp(name, "ntp") == 0)
            check(current.ntp_server.empty(),
                  "missing NTP server retains reset-to-default contract");
        if (std::strcmp(name, "weather") == 0)
            check(!current.weather_enabled, "both absent coordinates disable forecast");
        if (std::strcmp(name, "hp") == 0)
            check(current.rx_pin == 44 && current.mb_host == "old-hh.invalid",
                  "empty HP patch keeps independent domains");
        if (std::strcmp(name, "env3") == 0)
            check(saves == 0 && reboots == 0, "empty ENV patch keeps state");
    }
    for (const char* name : {"wifi", "diagnostics", "ota", "lang"}) {
        const auto& candidate = route(name);
        prepare(candidate);
        rejection(candidate, "{}");
    }
    const auto& wifi = route("wifi");
    prepare(wifi);
    const auto open = invoke(wifi.handler, R"({"ssid":"ExampleNet"})");
    check(open.status == "200 OK" && current.wifi_pass.empty(),
          "missing WiFi pass keeps documented open-network meaning");
}
void special_chars() {
    prepare(route("wifi"));
    const auto response = invoke(daik::set_wifi, R"({"ssid":" \"é\\網 ","pass":"ääää"})");
    check(response.status == "200 OK" && current.wifi_ssid == " \"é\\網 " &&
              current.wifi_pass == "ääää",
          "SSID/password quote/backslash/space/Unicode bytes changed");
    prepare(route("ref"));
    const auto room = invoke(
        daik::set_ref_temp,
        R"({"name":"Room \"A\" \\ é","topic":"fixture/a\"b\\c","temperature_path":"room.key","fixed_setpoint_c":20})");
    check(room.status == "200 OK" && current.ref_temp_name == "Room \"A\" \\ é" &&
              current.ref_temp_topic == "fixture/a\"b\\c",
          "escaped source identity changed or broke JSON response");
    for (const auto& candidate : routes) {
        prepare(candidate);
        const auto with_extra =
            changed(candidate.valid, "future_field", "\"quoted \\\" text \\\\ é\"");
        const auto result = invoke(candidate.handler, with_extra);
        check(result.status == "200 OK", "unknown-field forward compatibility changed");
    }
}
void preflight_failures() {
    const auto& mqtt = route("mqtt");
    for (unsigned fault = 0; fault < 10; ++fault) {
        prepare(mqtt);
        const char* status = "400 Bad Request";
        switch (fault) {
        case 0:
            network = false;
            break;
        case 1:
            dns_ok = false;
            break;
        case 2:
            tcp_ok = false;
            break;
        case 3:
            largest_block = 1;
            status        = "503 Service Unavailable";
            break;
        case 4:
            semaphore_ok = false;
            status       = "503 Service Unavailable";
            break;
        case 5:
            mqtt_init_ok = false;
            status       = "500 Internal Server Error";
            break;
        case 6:
            mqtt_register_ok = false;
            status           = "500 Internal Server Error";
            break;
        case 7:
            mqtt_start_ok = false;
            status        = "500 Internal Server Error";
            break;
        case 8:
            mqtt_wait_ok = false;
            break;
        case 9:
            mqtt_connected = false;
            mqtt_error     = true;
            break;
        }
        rejection(mqtt, mqtt.valid, status);
        check(mqtt_stops <= mqtt_starts && mqtt_destroys == (mqtt_init_ok ? mqtt_inits : 0U),
              "MQTT rejected preflight leaked client or stopped an unstarted client");
    }
    const auto& env = route("env3");
    prepare(env);
    env_probe = daik::Env3ProbeResult::BusUnavailable;
    rejection(env, env.valid, "503 Service Unavailable");
    prepare(env);
    env_probe = daik::Env3ProbeResult::Sht30Unavailable;
    rejection(env, env.valid, "422 Unprocessable Entity");
    prepare(env);
    env_probe = daik::Env3ProbeResult::Qmp6988Unavailable;
    rejection(env, env.valid, "422 Unprocessable Entity");
    const auto& forecast = route("weather");
    prepare(forecast);
    weather_admission = false;
    rejection(forecast, forecast.valid, "503 Service Unavailable");
    const auto& diagnostics = route("diagnostics");
    prepare(diagnostics);
    weather_admission = false;
    rejection(diagnostics, diagnostics.valid, "503 Service Unavailable");
    const auto& circ = route("circ");
    prepare(circ);
    proof_ok = false;
    rejection(circ, circ.valid, "409 Conflict");
}
void hp_revisions() {
    const auto& candidate = route("hp");
    prepare(candidate);
    stale_attempts    = 2;
    const auto result = invoke(candidate.handler, candidate.valid);
    check(result.status == "200 OK" && saves == 3 && service_writes == 0 && link_writes == 1,
          "HP stale revisions must rederive then write only link");
    prepare(candidate);
    stale_attempts      = 3;
    const auto response = invoke(candidate.handler, candidate.valid);
    check(response.status == "409 Conflict" && saves == 3 && service_writes == 0 &&
              link_writes == 0 && runtime_changes == 0,
          "HP stale retry limit must stop unchanged at three attempts");
    prepare(candidate);
    rejection(candidate, R"({"rx":9,"mb_host":"new.invalid"})");
}
void factory_reset_reboot() {
    for (const auto& candidate : routes) {
        if (!candidate.reboot) continue;
        for (const bool latch : {false, true}) {
            prepare(candidate);
            latch_during_delay  = latch;
            const auto response = invoke(candidate.handler, candidate.valid);
            check(response.status == "200 OK" && saves == 1 && service_writes == 1 &&
                      link_writes == 1,
                  "a reset starting in the response window must follow a completed setter save");
            check(delays == 1 && restart_guard_calls == 1 && restart_guard_after_delay,
                  "actual rebooting setter must check the reset latch after its response delay");
            check(reset_latched == latch && reboots == (latch ? 0U : 1U),
                  "setter reboot ignored the factory reset that latched during its delay");
            daik::JsonGuard document(daik::json_parse_document(response.response));
            check(bool(document) && cJSON_IsTrue(cJSON_GetObjectItem(document, "ok")) &&
                      cJSON_IsTrue(cJSON_GetObjectItem(document, "reboot")),
                  "a later factory reset must not rewrite the completed setter response");
        }
    }
    reset();
    reset_latched = true;
    daik::reboot_soon();
    check(delays == 1 && restart_guard_calls == 1 && restart_guard_after_delay && reboots == 0,
          "an already latched factory reset must keep the actual delayed restart held");
}
void local_pin_reconcile() {
    struct Scenario {
        const char* route;
        const char* body;
        int         collide_rx, collide_tx;
        int         allowed_rx, allowed_tx;
        bool        sensor;
    };
    const Scenario scenarios[] = {
        {"board", route("board").valid, 21, 22, 9, 10, false},
        {"board", route("board").valid, 22, 21, 9, 10, false},
        {"board", R"({"preset_id":"custom","led_gpio":-1,"btn_gpio":9})", 9, 10, 22, 23, false},
        {"board",
         R"({"preset_id":"m5stack_atoms3_lite","env3_enabled":true,"env3_sda":2,"env3_scl":1})", 2,
         1, 9, 10, true},
        {"env3", route("env3").valid, 2, 1, 9, 10, true},
        {"env3", route("env3").valid, 1, 2, 9, 10, true},
    };
    for (const auto& scenario : scenarios) {
        const auto& candidate = route(scenario.route);
        for (unsigned mode = 0; mode != 3; ++mode) {
            prepare(candidate);
            const auto before_service = service;
            const auto before_ram = daik::config_blob_serialize(daik::config_blob_from(current));
            const uint32_t before_revision = current.runtime_revision;
            detect_before_service_save     = true;
            detected_rx                    = mode == 0 ? scenario.collide_rx : scenario.allowed_rx;
            detected_tx                    = mode == 0 ? scenario.collide_tx : scenario.allowed_tx;
            if (mode == 2)
                save_fault = 1; // Real route-owned write failure after safe reconciliation.
            const auto response = invoke(candidate.handler, scenario.body);
            check(detection_writes == 1 && current.rx_pin == detected_rx &&
                      current.tx_pin == detected_tx && current.x10a_identity_fp == 0x51c07U,
                  "the actual detection transaction did not retain its independently owned link");
            check(saves == 1 && config_reads == 1 &&
                      env_probes == static_cast<unsigned>(scenario.sensor),
                  "local pin conflict must occur after one validated snapshot and required probe");
            if (mode == 1) {
                check(response.status == "200 OK" &&
                          last_save_outcome.result == daik::ConfigSaveResult::Saved &&
                          last_save_outcome.failed == daik::ConfigSaveStep::None,
                      "noncolliding detection must allow the actual service transaction");
                check(
                    service_writes == 1 && link_writes == 1 && link_snapshot_reads == 0 &&
                        reboots == 1 && delays == 1 && runtime_changes == 0 &&
                        current.runtime_revision ==
                            daik::config_next_revision(daik::config_next_revision(before_revision)),
                    "safe reconcile did not publish and reboot exactly one HTTP successor");
                check(service != before_service &&
                          daik::config_blob_serialize(daik::config_blob_from(current)) !=
                              before_ram,
                      "safe reconcile did not persist the validated local pin change");
            } else {
                check(response.status == (mode == 0 ? "409 Conflict" : "500 Internal Server Error"),
                      "local pin reconcile must distinguish a concurrent collision from a write "
                      "failure");
                check(last_save_outcome.result == (mode == 0 ? daik::ConfigSaveResult::Stale
                                                             : daik::ConfigSaveResult::Failed) &&
                          last_save_outcome.failed == (mode == 0
                                                           ? daik::ConfigSaveStep::None
                                                           : daik::ConfigSaveStep::ServiceWrite),
                      "local pin HTTP response did not follow the actual transaction outcome");
                check(service == before_service &&
                          daik::config_blob_serialize(daik::config_blob_from(current)) ==
                              before_ram &&
                          service_writes == (mode == 0 ? 0U : 1U) && link_writes == 0 &&
                          current.runtime_revision == daik::config_next_revision(before_revision),
                      "refused local pin save changed HTTP durability or RAM beyond detection");
                check(
                    link_snapshot_reads == 1 && reboots == 0 && delays == 0 &&
                        runtime_changes == 0 && weather_commits == 0,
                    "refused local pin save copied Config, rebooted or changed a runtime producer");
                daik::JsonGuard document(daik::json_parse_document(response.response));
                const cJSON*    error = cJSON_GetObjectItem(document, "error");
                check(bool(document) && cJSON_IsFalse(cJSON_GetObjectItem(document, "ok")) &&
                          cJSON_IsString(error) &&
                          std::strcmp(
                              error->valuestring,
                              mode == 0 ? "X10A link changed during save; check the pins and retry"
                                        : "config write failed") == 0,
                      "local pin save must return the stable JSON explanation for its outcome");
            }
        }
    }
}
void query_flags() {
    for (const char* value : {"", "0", "1", "true", "10", "1x", "2", "11111111"}) {
        reset();
        httpd_req_t request;
        request.query = std::string("after=7&channel=dev&version=1.0.1&sha256=") +
                        std::string(64, 'a') + "&downgrade=" + value;
        check(daik::ota_do(&request) == ESP_OK && ota_calls == 1 &&
                  ota_downgrade == (std::strcmp(value, "1") == 0),
              "actual OTA HTTP flag must grant downgrade only for exact literal 1");
    }
    reset();
    httpd_req_t missing;
    missing.query = std::string("after=7&channel=dev&version=1.0.1&sha256=") + std::string(64, 'a');
    check(daik::ota_do(&missing) == ESP_OK && ota_calls == 1 && !ota_downgrade,
          "missing downgrade flag must not inherit previous request permission");
}
uint32_t persisted_generation() {
    daik::ConfigBlob blob;
    check(daik::config_blob_deserialize(service.data(), service.size(), blob),
          "persisted service entry does not decode");
    return blob.diagnostics_generation;
}
// One actual /set_diagnostics transition from the stated generation with the given draw. Returns
// the generation the handler committed to RAM, the durable service entry and the live producer.
uint32_t transition(bool enabled, uint32_t draw) {
    saves = service_writes = link_writes = runtime_changes = weather_commits = 0;
    random_calls = runtime_generation_calls = 0;
    durable_started                         = false;
    random_value                            = draw;
    const auto response =
        invoke(daik::set_diagnostics, enabled ? R"({"enabled":true})" : R"({"enabled":false})");
    check(response.status == "200 OK" && saves == 1 && service_writes == 1,
          "diagnostics transition did not save exactly once");
    check(random_calls == 1, "diagnostics transition must draw esp_random() exactly once");
    check(current.diagnostics_enabled == enabled && runtime_generation_calls == 1,
          "diagnostics transition did not publish the requested consent");
    check(persisted_generation() == current.diagnostics_generation &&
              runtime_generation == current.diagnostics_generation,
          "durable, RAM and live producer generations disagree");
    return current.diagnostics_generation;
}
void diagnostics_generation() {
    // Default/migrated configuration: consent OFF at generation 0, as Config{} and pre-v19 load.
    const auto from_default = [] {
        reset();
        current.diagnostics_enabled    = false;
        current.diagnostics_generation = 0;
        service = daik::config_blob_serialize(daik::config_blob_from(current));
        service.reserve(16384);
        check(persisted_generation() == 0, "fixture must start from the default generation");
    };
    from_default();
    const uint32_t draw = 0x6d2b79f5U; // independent of the logic test's draw
    check(transition(true, draw) == draw,
          "first opt-in from generation 0 must persist the actual esp_random() draw");
    // Later transitions advance by one; a newer draw must not restart the sequence.
    check(transition(false, 0x0badf00dU) == draw + 1U,
          "a re-toggle must advance the persisted generation by one");
    check(transition(true, 0U) == draw + 2U, "a second re-toggle must advance by one again");
    saves = random_calls = runtime_generation_calls = 0;
    durable_started                                 = false;
    const auto unchanged = invoke(daik::set_diagnostics, R"({"enabled":true})");
    check(unchanged.status == "200 OK" && saves == 0 && random_calls == 0 &&
              runtime_generation_calls == 0 && persisted_generation() == draw + 2U,
          "an unchanged consent request must keep its generation without a draw");
    // A zero draw still leaves the default generation for a non-zero one.
    from_default();
    check(transition(true, 0U) == 1U, "a zero draw must still leave generation 0");
}
} // namespace test

int main(int argc, char** argv) {
    using namespace fixture;
    struct Case {
        const char* name;
        void (*run)();
    };
    const Case cases[] = {{"wrong_types", test::wrong_types},
                          {"integer_fields", test::integer_fields},
                          {"valid_setters", test::valid_setters},
                          {"bounds_and_modes", test::bounds_and_modes},
                          {"unchanged", test::unchanged},
                          {"persistence_failure", test::persistence_failure},
                          {"request_scratch", test::request_scratch},
                          {"ingress", test::ingress},
                          {"missing_and_disabled", test::missing_and_disabled},
                          {"special_chars", test::special_chars},
                          {"preflight_failures", test::preflight_failures},
                          {"hp_revisions", test::hp_revisions},
                          {"factory_reset_reboot", test::factory_reset_reboot},
                          {"local_pin_reconcile", test::local_pin_reconcile},
                          {"query_flags", test::query_flags},
                          {"diagnostics_generation", test::diagnostics_generation}};
    unsigned   ran     = 0;
    for (const auto& candidate : cases) {
        if (argc > 1) {
            if (std::strcmp(argv[1], "legacy_cases") == 0) {
                if (std::strcmp(candidate.name, "factory_reset_reboot") == 0 ||
                    std::strcmp(candidate.name, "local_pin_reconcile") == 0 ||
                    std::strcmp(candidate.name, "diagnostics_generation") == 0)
                    continue;
            } else if (std::strcmp(argv[1], candidate.name) != 0)
                continue;
        }
        oracle = candidate.name;
        candidate.run();
        ++ran;
        std::printf("PASS %s\n", candidate.name);
    }
    check(ran != 0, "fixture case was not selected");
    std::printf("PASS total=%u assertions=%u\n", ran, checks);
    return 0;
}
