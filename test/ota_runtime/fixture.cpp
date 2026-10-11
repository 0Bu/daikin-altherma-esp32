// Compile and execute the entire current OTA component; only SDK and service boundaries are fake.
#include "sdk.hpp"
#include <algorithm>
#include <cstdio>
#include <iostream>
#include <stdexcept>
#include <string>
#ifndef OTA_PRODUCTION_SOURCE
#error "Compile against the complete current main/ota_update.cpp"
#endif
#include OTA_PRODUCTION_SOURCE

namespace sdk {
State state;
void  inject(Fault fault) {
    if (state.fault == fault && !state.injected) {
        state.injected = true;
        throw std::bad_alloc();
    }
}
} // namespace sdk

void* operator new(size_t n) {
    if (sdk::state.reject_new) throw std::bad_alloc();
    if (void* p = std::malloc(n ? n : 1)) return p;
    throw std::bad_alloc();
}
void* operator new[](size_t n) { return ::operator new(n); }
void  operator delete(void* p) noexcept { std::free(p); }
void  operator delete[](void* p) noexcept { std::free(p); }
void  operator delete(void* p, size_t) noexcept { std::free(p); }
void  operator delete[](void* p, size_t) noexcept { std::free(p); }

void* heap_caps_malloc(size_t n, unsigned) {
    auto& s = sdk::state;
    if (s.fault == sdk::Fault::BufferNull ||
        (s.fault == sdk::Fault::ResumeBufferNull && s.firmware_acquired > 1))
        return nullptr;
    void* p = std::malloc(n);
    for (auto& entry : s.buffers) {
        if (!entry) {
            entry = p;
            ++s.buffer_acquired;
            ++s.active_buffers;
            return p;
        }
    }
    std::free(p);
    throw std::runtime_error("fixture buffer ledger full");
}
void heap_caps_free(void* p) noexcept {
    if (!p) return;
    auto& s = sdk::state;
    for (auto& entry : s.buffers) {
        if (entry == p) {
            entry = nullptr;
            ++s.buffer_freed;
            --s.active_buffers;
            std::free(p);
            return;
        }
    }
    s.invalid_release = true;
}
size_t heap_caps_get_free_size(unsigned) {
    auto& s = sdk::state;
    if (s.firmware_cleaned && s.ota_live) sdk::inject(sdk::Fault::AfterTlsException);
    return s.free_bytes;
}
esp_http_client_handle_t esp_http_client_init(const esp_http_client_config_t* cfg) {
    auto& s = sdk::state;
    for (auto& c : s.clients) {
        // Do not reuse slots: the cleanup oracle also detects stale-handle accesses.
        if (c.sequence == 0) {
            c.cfg      = *cfg;
            c.used     = true;
            c.manifest = std::strstr(cfg->url, "manifest.json") != nullptr;
            c.sequence = ++s.client_acquired;
            ++s.active_clients;
            if (!c.manifest) ++s.firmware_acquired;
            return &c;
        }
    }
    throw std::runtime_error("fixture client ledger full");
}
esp_err_t esp_http_client_open(esp_http_client_handle_t, int) { return ESP_OK; }
int64_t   esp_http_client_fetch_headers(esp_http_client_handle_t c) {
    if (c->resumed) {
        sdk::inject(sdk::Fault::ResumeException);
        char key[] = "Content-Range", value[96];
        std::snprintf(value, sizeof(value), "bytes %zu-%zu/%zu", c->offset,
                        sdk::state.image_size - (sdk::state.fault == sdk::Fault::WrongRange ? 2 : 1),
                        sdk::state.image_size);
        esp_http_client_event_t event{HTTP_EVENT_ON_HEADER, c->cfg.user_data, key, value};
        if (c->cfg.event_handler) c->cfg.event_handler(&event);
    }
    // IDF returns zero for chunked headers, although content length remains unknown.
    return esp_http_client_is_chunked_response(c) ? 0 : esp_http_client_get_content_length(c);
}
int esp_http_client_get_status_code(esp_http_client_handle_t c) { return c->resumed ? 206 : 200; }
int64_t esp_http_client_get_content_length(esp_http_client_handle_t c) {
    if (!c->manifest && (sdk::state.fault == sdk::Fault::ChunkedSuccess ||
                         sdk::state.fault == sdk::Fault::ShortChunked))
        return -1;
    return c->manifest ? std::strlen(sdk::state.manifest)
                       : sdk::state.image_size - (c->resumed ? c->offset : 0);
}
bool esp_http_client_is_chunked_response(esp_http_client_handle_t c) {
    return !c->manifest && (sdk::state.fault == sdk::Fault::ChunkedSuccess ||
                            sdk::state.fault == sdk::Fault::ShortChunked);
}
int esp_http_client_read(esp_http_client_handle_t c, char* out, int requested) {
    auto& s = sdk::state;
    if (!c->manifest && c->offset == 0) sdk::inject(sdk::Fault::HeaderException);
    if (!c->manifest && !c->resumed && c->offset != 0 && s.interrupt && !s.injected) {
        // Resume exception uses a different injection latch: the network interruption itself
        // is an ordinary SDK read error, not a throwing C API.
        s.interrupt = false;
        return -1;
    }
    if (!c->manifest && c->offset != 0 && s.fault == sdk::Fault::ReadError) return -1;
    if (!c->manifest && c->offset != 0 && s.fault == sdk::Fault::ShortChunked) return 0;
    if (!c->manifest && c->offset != 0 && s.fault == sdk::Fault::BodyTimeout) {
        s.ticks += 300000;
        return -ESP_ERR_HTTP_EAGAIN;
    }
    const auto*  body  = c->manifest ? reinterpret_cast<const uint8_t*>(s.manifest) : s.image;
    const size_t total = c->manifest ? std::strlen(s.manifest) : s.image_size;
    const size_t n     = std::min(static_cast<size_t>(requested), total - c->offset);
    std::memcpy(out, body + c->offset, n);
    c->offset += n;
    return static_cast<int>(n);
}
bool esp_http_client_is_complete_data_received(esp_http_client_handle_t c) {
    return c->offset == (c->manifest ? std::strlen(sdk::state.manifest) : sdk::state.image_size);
}
esp_err_t esp_http_client_close(esp_http_client_handle_t c) noexcept {
    auto& s = sdk::state;
    if (!c->used || c->closed || s.deadline_armed) s.invalid_release = true;
    c->closed = true;
    ++s.client_closed;
    return ESP_OK;
}
esp_err_t esp_http_client_cleanup(esp_http_client_handle_t c) noexcept {
    auto& s = sdk::state;
    if (!c->used || !c->closed || s.deadline_armed) s.invalid_release = true;
    c->used = false;
    ++s.client_cleaned;
    --s.active_clients;
    if (!c->manifest) ++s.firmware_cleaned;
    return ESP_OK;
}
esp_err_t esp_http_client_set_header(esp_http_client_handle_t c, const char*, const char* value) {
    c->offset  = static_cast<size_t>(std::strtoull(value + 6, nullptr, 10));
    c->resumed = true;
    return ESP_OK;
}
const esp_partition_t* esp_ota_get_next_update_partition(const esp_partition_t*) {
    static esp_partition_t partition;
    return &partition;
}
const esp_partition_t* esp_ota_get_running_partition() {
    return esp_ota_get_next_update_partition(nullptr);
}
esp_err_t esp_ota_get_state_partition(const esp_partition_t*, esp_ota_img_states_t* state) {
    *state = sdk::state.image_state;
    return sdk::state.state_result;
}
esp_err_t esp_ota_begin(const esp_partition_t*, size_t, esp_ota_handle_t* handle) {
    auto& s = sdk::state;
    if (s.fault == sdk::Fault::BeginProbation) return ESP_ERR_OTA_ROLLBACK_INVALID_STATE;
    if (s.ota_live) s.invalid_release = true;
    ++s.ota_begun;
    s.ota_live = true;
    *handle    = 1;
    return ESP_OK;
}
esp_err_t esp_ota_write(esp_ota_handle_t, const void* data, size_t len) {
    auto& s = sdk::state;
    if (!s.ota_live) s.invalid_release = true;
    if (s.fault == sdk::Fault::WriteError) return ESP_FAIL;
    if (s.written + len > s.image_size || std::memcmp(data, s.image + s.written, len) != 0)
        s.invalid_release = true;
    s.written += len;
    return ESP_OK;
}
esp_err_t esp_ota_abort(esp_ota_handle_t) noexcept {
    auto& s = sdk::state;
    if (!s.ota_live) s.invalid_release = true;
    s.ota_live = false;
    ++s.ota_aborted;
    return ESP_OK;
}
esp_err_t esp_ota_end(esp_ota_handle_t) {
    auto& s = sdk::state;
    if (!s.ota_live || s.active_clients || s.active_buffers || s.hash_live ||
        s.written != s.image_size)
        s.invalid_release = true;
    s.ota_live = false; // IDF consumes this handle on both success and error.
    ++s.ota_ended;
    return s.fault == sdk::Fault::ValidationError ? ESP_ERR_OTA_VALIDATE_FAILED : ESP_OK;
}
esp_err_t esp_ota_set_boot_partition(const esp_partition_t*) {
    auto& s = sdk::state;
    if (s.ota_ended != 1 || s.ota_live || s.active_clients || s.active_buffers)
        s.invalid_release = true;
    ++s.selected;
    return s.fault == sdk::Fault::SelectionError ? ESP_FAIL : ESP_OK;
}
psa_status_t psa_hash_setup(psa_hash_operation_t* op, int) {
    op->active           = true;
    sdk::state.hash_live = true;
    ++sdk::state.hash_setup;
    return PSA_SUCCESS;
}
psa_status_t psa_hash_update(psa_hash_operation_t* op, const uint8_t* data, size_t len) {
    sdk::inject(sdk::Fault::HashException);
    if (!op->active) sdk::state.invalid_release = true;
    if (sdk::state.fault == sdk::Fault::HashError) return -1;
    if (op->bytes + len > sdk::state.image_size ||
        std::memcmp(data, sdk::state.image + op->bytes, len) != 0)
        sdk::state.invalid_release = true;
    op->bytes += len;
    return PSA_SUCCESS;
}
psa_status_t psa_hash_finish(psa_hash_operation_t* op, uint8_t* out, size_t, size_t* len) {
    auto& s = sdk::state;
    if (!op->active || op->bytes != s.image_size) s.invalid_release = true;
    op->active  = false;
    s.hash_live = false;
    ++s.hash_finished;
    std::memset(out, s.fault == sdk::Fault::HashMismatch ? 0xbb : 0xaa, 32);
    *len = 32;
    return PSA_SUCCESS;
}
psa_status_t psa_hash_abort(psa_hash_operation_t* op) noexcept {
    if (!op->active) sdk::state.invalid_release = true;
    op->active           = false;
    sdk::state.hash_live = false;
    ++sdk::state.hash_aborted;
    return PSA_SUCCESS;
}

namespace daik {
OtaChannel    config_ota_channel() { return OtaChannel::Dev; }
bool          hp_poll_ota_quiesced() { return sdk::state.stalled_service != 1; }
bool          mqtt_publish_network_quiesced() { return sdk::state.stalled_service != 2; }
bool          mqtt_transport_network_quiesced() { return sdk::state.stalled_service != 3; }
bool          mb_network_quiesced() { return sdk::state.stalled_service != 4; }
bool          hp_modbus_ota_quiesced() { return true; }
bool          syslog_network_quiesced() { return sdk::state.stalled_service != 5; }
bool          weather_fetch_active() { return sdk::state.stalled_service == 6; }
void          mqtt_transport_withdraw_online_on_pause() { ++sdk::state.withdraw; }
void          mqtt_transport_pause_for_network_heap() { ++sdk::state.pause; }
void          mqtt_transport_resume_after_network_heap() { ++sdk::state.resume; }
void          stack_watch_sample(StackWatch) noexcept {}
uint32_t      stack_watch_min_free_bytes(StackWatch) noexcept { return 4096; }
size_t        heap_largest_internal_block() { return sdk::state.largest_block; }
uint8_t       heap_guard_restarts() { return sdk::state.heap_restarts; }
MqttSkipStats mqtt_skip_stats() {
    MqttSkipStats s{};
    s.skipped = sdk::state.mqtt_skips;
    return s;
}
uint32_t hp_skipped_cycles() { return sdk::state.poll_skips; }
bool     hp_link_connected() { return sdk::state.hp_live; }
bool     mqtt_x10a_publish_required() { return sdk::state.x10a_required; }
bool     mqtt_x10a_publish_proven() { return sdk::state.x10a_proven; }
NetLink  net_kind() { return sdk::state.health_offline ? NetLink::None : NetLink::Wifi; }
bool     provisioning_ap_active() { return sdk::state.recovery_ap; }
void     diag_printf(const char*, ...) {}
bool     http_deadline_init() noexcept { return true; }
bool     http_deadline_ready() noexcept { return true; }
HttpSocketDeadline::~HttpSocketDeadline() { disarm(); }
esp_err_t HttpSocketDeadline::arm(esp_http_client_handle_t, TickType_t started,
                                  TickType_t duration) noexcept {
    if (sdk::state.deadline_armed) sdk::state.invalid_release = true;
    started_                  = started;
    duration_                 = duration;
    active_                   = true;
    sdk::state.deadline_armed = true;
    ++sdk::state.deadline_arms;
    return ESP_OK;
}
bool HttpSocketDeadline::expired() const noexcept { return expired_latched_; }
bool HttpSocketDeadline::disarm() noexcept {
    if (active_) {
        ++sdk::state.deadline_disarms;
        sdk::state.deadline_armed = false;
        active_                   = false;
    }
    return false;
}
HttpClientProbe       http_client_probe() noexcept { return {128 * 1024, 64 * 1024, 4096}; }
void                  http_client_log_init_failure(const char*, const HttpClientProbe&) noexcept {}
HttpClientOpenFailure http_client_log_open_failure(const char*, esp_http_client_handle_t,
                                                   esp_err_t e, const HttpClientProbe&) noexcept {
    return {e, 0, 0, 0};
}
HttpClientReadFailure http_client_log_read_failure(const char*, esp_http_client_handle_t, int,
                                                   size_t, int64_t, uint32_t) noexcept {
    return {};
}
} // namespace daik

namespace test {
struct AssertionFailure : std::runtime_error {
    using std::runtime_error::runtime_error;
};
#define REQUIRE(c)                                                                                 \
    do {                                                                                           \
        if (!(c)) throw AssertionFailure(#c);                                                      \
    } while (0)
constexpr const char* long_version = "1.0.8-dev.12345678901234567890";

void reset(sdk::Fault fault) {
    sdk::state  = sdk::State{};
    auto& s     = sdk::state;
    s.fault     = fault;
    s.interrupt = fault == sdk::Fault::ResumeException || fault == sdk::Fault::ResumeBufferNull ||
                  fault == sdk::Fault::ResumeSuccess || fault == sdk::Fault::WrongRange;
    std::strcpy(s.app.version, "1.0.7");
    std::snprintf(s.manifest, sizeof(s.manifest),
                  "{\"version\":\"%s\",\"provenance\":{\"app_sha256\":\"%s\"}}", long_version,
                  "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
    esp_image_header_t header{};
    header.magic   = ESP_IMAGE_HEADER_MAGIC;
    header.chip_id = CONFIG_IDF_FIRMWARE_CHIP_ID;
    esp_app_desc_t app{};
    app.magic_word = ESP_APP_DESC_MAGIC_WORD;
    std::strcpy(app.version, long_version);
    std::memcpy(s.image, &header, sizeof(header));
    std::memcpy(s.image + sizeof(header) + sizeof(esp_image_segment_header_t), &app, sizeof(app));
    daik::s_status = daik::OtaStatus{};
    daik::s_network_active.store(false);
    daik::s_busy       = false;
    daik::s_ota_task   = nullptr;
    daik::s_generation = 0;
    daik::s_health_gate_armed.store(false);
    daik::s_task_args = daik::OtaTaskArgs{};
}

void worker(sdk::Fault fault, int stalled_service = 0, bool malformed_manifest = false,
            bool mismatched_image = false) {
    reset(fault);
    using namespace daik;
    sdk::state.stalled_service = stalled_service;
    if (malformed_manifest) {
        const auto len               = std::strlen(sdk::state.manifest);
        sdk::state.manifest[len - 1] = ','; // complete HTTP body; incomplete JSON root.
    }
    if (mismatched_image) {
        esp_app_desc_t wrong{};
        wrong.magic_word = ESP_APP_DESC_MAGIC_WORD;
        std::strcpy(wrong.version, "1.0.9");
        std::memcpy(sdk::state.image + sizeof(esp_image_header_t) +
                        sizeof(esp_image_segment_header_t),
                    &wrong, sizeof(wrong));
    }
    ota_update_init();
    OtaTaskArgs request{};
    request.mode    = OtaTaskMode::Update;
    request.channel = OtaChannel::Dev;
    REQUIRE(ota_default_feed_urls(OtaChannel::Dev, CONFIG_DAIKIN_OTA_MANIFEST_URL,
                                  CONFIG_DAIKIN_OTA_FIRMWARE_BASE_URL, request.offer.feed));
    std::strcpy(request.offer.version.data(), long_version);
    std::memset(request.offer.app_sha256.data(), 'a', 64);
    request.offer.app_sha256[64] = '\0';
    start_locked(request, 0);
    REQUIRE(ota_busy());
    try {
        s_ota_task->fn(s_ota_task->arg);
    } catch (const sdk::Stop&) {}
    const auto& s = sdk::state;
    REQUIRE(s.notifications == 2);
    REQUIRE(!ota_busy());
    REQUIRE(!ota_download_active());
    REQUIRE(s.withdraw == 1 && s.pause == 1 && s.resume == 1);
    REQUIRE(!s.invalid_release);
    REQUIRE(s.active_clients == 0 && s.active_buffers == 0);
    REQUIRE(!s.ota_live && !s.hash_live && !s.deadline_armed);
    REQUIRE(s.client_acquired == s.client_cleaned && s.client_cleaned == s.client_closed);
    REQUIRE(s.buffer_acquired == s.buffer_freed);
    REQUIRE(s.ota_begun == s.ota_ended + s.ota_aborted);
    REQUIRE(s.hash_setup == s.hash_finished + s.hash_aborted);
    REQUIRE(s.deadline_arms == s.deadline_disarms);
    if ((fault == sdk::Fault::None || fault == sdk::Fault::ResumeSuccess ||
         fault == sdk::Fault::ChunkedSuccess) &&
        !stalled_service && !malformed_manifest && !mismatched_image) {
        REQUIRE(s.selected == 1 && s.restart == 1 && s.ota_ended == 1 && s.ota_aborted == 0);
        REQUIRE(s_status.state == "done" && s_status.progress == 100);
        if (fault == sdk::Fault::ResumeSuccess)
            REQUIRE(s.firmware_acquired == 2 && s.buffer_acquired == 2 &&
                    s.written == s.image_size);
    } else {
        REQUIRE(s.restart == 0);
        REQUIRE(s.selected == (fault == sdk::Fault::SelectionError ? 1 : 0));
        REQUIRE(s_status.state == "error");
        if (stalled_service) {
            REQUIRE(s.client_acquired == 0 && s.ota_begun == 0);
            const TickType_t wait = stalled_service == 6 ? 20000 : 15000;
            REQUIRE(s.ticks == 1000 + 1100 + wait);
        }
        if (malformed_manifest) REQUIRE(s.firmware_acquired == 0 && s.ota_begun == 0);
        if (mismatched_image) REQUIRE(s.written == 0 && s.ota_aborted == 1);
        if (fault == sdk::Fault::BeginProbation) {
            REQUIRE(s.ota_begun == 0 && s.written == 0 && s.hash_setup == 0 && s.ota_ended == 0);
            REQUIRE(s_status.message ==
                    "Firmware health check is still running — retry in a moment");
        }
        if (fault == sdk::Fault::ValidationError || fault == sdk::Fault::SelectionError)
            REQUIRE(s.ota_ended == 1 && s.ota_aborted == 0);
        if (fault == sdk::Fault::HeaderException || fault == sdk::Fault::HashException ||
            fault == sdk::Fault::ResumeException || fault == sdk::Fault::AfterTlsException)
            REQUIRE(s.injected);
        if (fault == sdk::Fault::ResumeException || fault == sdk::Fault::ResumeBufferNull)
            REQUIRE(s.firmware_acquired == 2 && s.buffer_freed == 1);
    }
}

void helpers_no_allocation() {
    reset(sdk::Fault::None);
    bool match = false, allowed = false, threw = false;
    sdk::state.reject_new = true;
    try {
        match   = daik::ota_artifact_versions_match(long_version, long_version);
        allowed = daik::ota_install_allowed("1.0.7", long_version, false);
    } catch (const std::bad_alloc&) {
        threw = true;
    }
    sdk::state.reject_new = false;
    REQUIRE(!threw && match && allowed);
}

void manifest_bounds() {
    reset(sdk::Fault::None);
    daik::OtaManifestIdentity identity{};
    const std::string         good(sdk::state.manifest);
    auto                      accepts = [&](const std::string& body) {
        return daik::manifest_identity(body.data(), body.size(), identity);
    };
    REQUIRE(accepts(good));
    REQUIRE(std::strcmp(identity.version, long_version) == 0);
    REQUIRE(!accepts(good.substr(0, good.size() - 1)));
    REQUIRE(!accepts(good.substr(0, good.size() - 1) + ","));
    REQUIRE(!accepts(good.substr(0, good.size() - 1) + ", \n\t"));
    REQUIRE(!accepts(good.substr(0, good.size() - 1) + ",}"));
    REQUIRE(!accepts(good + "x"));
    REQUIRE(accepts(good + " \n"));
    // Unknown extra fields use the actual bounded recursive parser: seven containers and their
    // terminal scalar occupy depth eight; the eighth container puts the scalar at depth nine.
    REQUIRE(accepts(good.substr(0, good.size() - 1) + ",\"extra\":" + std::string(7, '[') + "0" +
                    std::string(7, ']') + "}"));
    REQUIRE(!accepts(good.substr(0, good.size() - 1) + ",\"extra\":" + std::string(8, '[') + "0" +
                     std::string(8, ']') + "}"));
    worker(sdk::Fault::None, 0, true);
}

void health(const char* name) {
    reset(sdk::Fault::None);
    auto& s       = sdk::state;
    s.image_state = ESP_OTA_IMG_PENDING_VERIFY;
    daik::s_runtime_image_state.store(
        static_cast<uint8_t>(daik::OtaRuntimeImageState::PendingVerify));
    if (std::strcmp(name, "health_unknown") == 0) s.state_result = ESP_FAIL;
    if (std::strcmp(name, "health_valid") == 0) s.image_state = ESP_OTA_IMG_VALID;
    if (std::strcmp(name, "health_unarmed") == 0) s.image_state = ESP_OTA_IMG_NEW;
    if (std::strcmp(name, "health_timeout") == 0) s.health_offline = true;
    if (std::strcmp(name, "health_mark_error") == 0) s.mark_result = ESP_FAIL;
    bool reject = s.health_offline;
    if (std::strcmp(name, "health_heap_boundary") == 0) {
        s.free_bytes    = 24 * 1024;
        s.largest_block = 16 * 1024;
    }
    if (std::strcmp(name, "health_low_free") == 0) {
        s.free_bytes = 24 * 1024 - 1;
        reject       = true;
    }
    if (std::strcmp(name, "health_low_block") == 0) {
        s.largest_block = 16 * 1024 - 1;
        reject          = true;
    }
    if (std::strcmp(name, "health_heap_restart") == 0) {
        s.heap_restarts = 1;
        reject          = true;
    }
    if (std::strcmp(name, "health_mqtt_skip") == 0) {
        s.mqtt_skips = 1;
        reject       = true;
    }
    if (std::strcmp(name, "health_poll_skip") == 0) {
        s.poll_skips = 1;
        reject       = true;
    }
    if (std::strcmp(name, "health_x10a_missing") == 0 ||
        std::strcmp(name, "health_x10a_proven") == 0) {
        s.hp_live = s.x10a_required = true;
        s.x10a_proven               = std::strcmp(name, "health_x10a_proven") == 0;
        reject                      = !s.x10a_proven;
    }
    if (std::strcmp(name, "health_x10a_optional") == 0) s.hp_live = true;
    if (std::strcmp(name, "health_ap_recovery") == 0) {
        s.health_offline = s.recovery_ap = true;
        s.free_bytes = s.largest_block = 1;
        s.mqtt_skips                   = 1;
    }
    if (std::strcmp(name, "health_task_error_unknown") == 0) {
        s.fail_task_create = true;
        daik::s_runtime_image_state.store(
            static_cast<uint8_t>(daik::OtaRuntimeImageState::Unknown));
        daik::ota_health_gate_arm();
        REQUIRE(s.created == 1 && s.marked == 0 && s.restart == 0);
        const auto status = daik::ota_status();
        REQUIRE(status.image_state == "unknown" && !status.rollback_pending_known);
        return;
    }
    if (std::strcmp(name, "health_static_storage") == 0) {
        s.fail_dynamic_create = true;
        daik::ota_health_gate_arm();
        REQUIRE(s.static_creations == 1 && s.dynamic_creations == 0);
        REQUIRE(s.health_stack != nullptr && s.health_storage != nullptr);
        REQUIRE(s.health_stack_bytes == 4096);
        REQUIRE(reinterpret_cast<uintptr_t>(s.health_stack) % portBYTE_ALIGNMENT == 0);
        REQUIRE(s.health_entry == daik::health_gate_task);
        daik::ota_health_gate_arm();
        REQUIRE(s.created == 1); // no second task may share the active stack.
        s.health_entry(nullptr);
        REQUIRE(s.marked == 1 && daik::ota_status().image_state == "valid");
        daik::ota_health_gate_arm();
        REQUIRE(s.created == 1); // self-deletion does not permit same-boot reuse.
        return;
    }
    if (std::strcmp(name, "health_task_error") == 0) {
        s.fail_task_create = true;
        daik::ota_health_gate_arm();
        REQUIRE(s.created == 1 && s.marked == 0 && s.restart == 0);
        REQUIRE(daik::ota_status().image_state == "pending_verify");
        return;
    }
    daik::health_gate_task(nullptr);
    const auto status = daik::ota_status();
    if (s.state_result != ESP_OK) {
        REQUIRE(status.image_state == "unknown" && !status.rollback_pending_known);
        REQUIRE(s.marked == 0 && s.restart == 0 && s.ticks == 1000);
    } else if (s.image_state != ESP_OTA_IMG_PENDING_VERIFY) {
        REQUIRE(status.image_state == (s.image_state == ESP_OTA_IMG_VALID ? "valid" : "unarmed"));
        REQUIRE(s.marked == 0 && s.restart == 0 && s.ticks == 1000);
    } else if (reject) {
        REQUIRE(s.marked == 0 && s.restart == 1 && s.restarted_at == 602000);
        REQUIRE(status.image_state == "pending_verify" && status.rollback_pending);
    } else {
        REQUIRE(s.marked == 1 && s.marked_at == 91000 && s.restart == 0);
        REQUIRE(status.image_state == (s.mark_result == ESP_OK ? "valid" : "pending_verify"));
    }
}
} // namespace test

int main(int argc, char** argv) {
    struct Case {
        const char* name;
        sdk::Fault  fault;
    };
    const Case cases[] = {
        {"success", sdk::Fault::None},
        {"header_exception", sdk::Fault::HeaderException},
        {"hash_exception", sdk::Fault::HashException},
        {"resume_exception", sdk::Fault::ResumeException},
        {"after_tls_exception", sdk::Fault::AfterTlsException},
        {"buffer_null", sdk::Fault::BufferNull},
        {"resume_buffer_null", sdk::Fault::ResumeBufferNull},
        {"read_error", sdk::Fault::ReadError},
        {"write_error", sdk::Fault::WriteError},
        {"hash_error", sdk::Fault::HashError},
        {"hash_mismatch", sdk::Fault::HashMismatch},
        {"validation_error", sdk::Fault::ValidationError},
        {"selection_error", sdk::Fault::SelectionError},
        {"resume_success", sdk::Fault::ResumeSuccess},
        {"wrong_range", sdk::Fault::WrongRange},
        {"chunked_success", sdk::Fault::ChunkedSuccess},
        {"short_chunked", sdk::Fault::ShortChunked},
        {"body_timeout", sdk::Fault::BodyTimeout},
        {"begin_probation", sdk::Fault::BeginProbation},
    };
    int count = 0;
    for (const auto& c : cases) {
        if (argc > 1 && std::strcmp(argv[1], c.name) != 0) continue;
        try {
            test::worker(c.fault);
        } catch (const std::exception& e) {
            std::cerr << (dynamic_cast<const test::AssertionFailure*>(&e) ? "ASSERT " : "ERROR ")
                      << "" << c.name << ": " << e.what() << '\n';
            return dynamic_cast<const test::AssertionFailure*>(&e) ? 1 : 2;
        }
        std::cout << "PASS " << c.name << '\n';
        ++count;
    }
    if (argc == 1 || std::strcmp(argv[1], "helpers_no_allocation") == 0) {
        try {
            test::helpers_no_allocation();
        } catch (const std::exception& e) {
            std::cerr << (dynamic_cast<const test::AssertionFailure*>(&e) ? "ASSERT " : "ERROR ")
                      << "helpers_no_allocation: " << e.what() << '\n';
            return dynamic_cast<const test::AssertionFailure*>(&e) ? 1 : 2;
        }
        std::cout << "PASS helpers_no_allocation\n";
        ++count;
    }
    if (argc == 1 || std::strcmp(argv[1], "manifest_bounds") == 0) {
        try {
            test::manifest_bounds();
        } catch (const std::exception& e) {
            std::cerr << (dynamic_cast<const test::AssertionFailure*>(&e) ? "ASSERT " : "ERROR ")
                      << "manifest_bounds: " << e.what() << '\n';
            return dynamic_cast<const test::AssertionFailure*>(&e) ? 1 : 2;
        }
        std::cout << "PASS manifest_bounds\n";
        ++count;
    }
    if (argc == 1 || std::strcmp(argv[1], "image_binding") == 0) {
        try {
            test::worker(sdk::Fault::None, 0, false, true);
        } catch (const std::exception& e) {
            std::cerr << (dynamic_cast<const test::AssertionFailure*>(&e) ? "ASSERT " : "ERROR ")
                      << "image_binding: " << e.what() << '\n';
            return dynamic_cast<const test::AssertionFailure*>(&e) ? 1 : 2;
        }
        std::cout << "PASS image_binding\n";
        ++count;
    }
    for (int stalled = 1; stalled <= 6; ++stalled) {
        const std::string name = "quiesce_" + std::to_string(stalled);
        if (argc > 1 && name != argv[1]) continue;
        try {
            test::worker(sdk::Fault::None, stalled);
        } catch (const std::exception& e) {
            std::cerr << (dynamic_cast<const test::AssertionFailure*>(&e) ? "ASSERT " : "ERROR ")
                      << "" << name << ": " << e.what() << '\n';
            return dynamic_cast<const test::AssertionFailure*>(&e) ? 1 : 2;
        }
        std::cout << "PASS " << name << '\n';
        ++count;
    }
    const char* health_cases[] = {
        "health_unknown",       "health_valid",         "health_unarmed",
        "health_commit",        "health_timeout",       "health_mark_error",
        "health_task_error",    "health_heap_boundary", "health_low_free",
        "health_low_block",     "health_heap_restart",  "health_mqtt_skip",
        "health_poll_skip",     "health_x10a_missing",  "health_x10a_proven",
        "health_x10a_optional", "health_ap_recovery",   "health_task_error_unknown",
        "health_static_storage"};
    for (const auto* name : health_cases) {
        if (argc > 1 && std::strcmp(argv[1], name) != 0) continue;
        try {
            test::health(name);
        } catch (const std::exception& e) {
            std::cerr << (dynamic_cast<const test::AssertionFailure*>(&e) ? "ASSERT " : "ERROR ")
                      << "" << name << ": " << e.what() << '\n';
            return dynamic_cast<const test::AssertionFailure*>(&e) ? 1 : 2;
        }
        std::cout << "PASS " << name << '\n';
        ++count;
    }
    if (!count) return 2;
    std::cout << "PASS total=" << count << '\n';
    return 0;
}
