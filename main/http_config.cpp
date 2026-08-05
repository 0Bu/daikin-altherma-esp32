// POST config routes: /set_wifi, /set_mqtt, /test_ref_temp, /set_ref_temp, /set_weather,
// /set_dynamic_lwt, /set_syslog, /set_ntp, /set_hp,
// /set_board, /set_env3, /set_ota, /set_lang, /discover_homehub, /detect. Parse JSON, validate, then apply:
// WiFi/MQTT/syslog/NTP/board persist to NVS + reboot; the reference mapping is first tested without
// persistence, then its proof-gated save applies live; /set_dynamic_lwt persists OFF/SHADOW and is
// evaluated on the next mqtt-task cycle; /set_hp persists the RX/TX pin cache (no reboot) but keeps
// the model session-only;
// /set_ota and /set_lang persist their UI settings and apply them live; /detect re-runs detection in
// RAM.
#include "http_handlers.hpp"
#include "checkup.hpp"
#include "config.hpp"
#include "env3.hpp"
#include "history.hpp"
#include "hp_poll.hpp"
#include "logic/config_model.hpp"
#include "logic/env3.hpp"
#include "logic/mqtt_uri.hpp"   // parse_mqtt_uri — host/port/TLS split, host-tested
#include "logic/reference_temperature.hpp"
#include "logic/weather_forecast.hpp"
#include "hp_modbus.hpp"        // mb_reconfigure — start/stop the second, independent stack
#include "mqtt_ha.hpp"           // mqtt_reference_reconfigure — apply its exact subscription live
#include "weather_forecast.hpp"

#include "cJSON.h"
#include "esp_http_server.h"
#include "esp_system.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "soc/soc_caps.h"   // SOC_GPIO_PIN_COUNT — per-target GPIO count for pin validation

#include "esp_crt_bundle.h"
#include "esp_heap_caps.h"   // largest-free-block guard before a transient TLS validation session
#include "mqtt_client.h"
#include "wifi.hpp"
#include "diag_log.hpp"      // diag_printf — record when a low-heap probe is skipped
#include <sys/socket.h>
#include <netdb.h>
#include <fcntl.h>
#include <cmath>
#include <cerrno>       // errno / EINPROGRESS in the non-blocking TCP probe
#include <cstring>

namespace daik {

static void reboot_soon() { vTaskDelay(pdMS_TO_TICKS(400)); esp_restart(); }

// Every write endpoint answers a rejection as {"ok":false,"error":…} (DESIGN.md §8: a 4xx becomes an
// inline field error). Both callers — the dashboard modals and the setup portal — read `error` out of
// the JSON. `msg` is always an internal literal here (body/JSON parse failures and the fixed
// wifi_credentials_valid reasons), so it needs no escaping; never pass caller-supplied text.
static esp_err_t send_err(httpd_req_t* req, const char* status, const char* msg) {
    httpd_resp_set_status(req, status);
    return http_send_json(req, (std::string("{\"ok\":false,\"error\":\"") + msg + "\"}").c_str());
}

// ENV III reachability failures carry a stable code so the bilingual UI can translate them while
// direct API clients still receive a useful English explanation.  All values are internal literals.
static esp_err_t send_env3_err(httpd_req_t* req, const char* status,
                               const char* code, const char* msg) {
    httpd_resp_set_status(req, status);
    std::string body = "{\"ok\":false,\"code\":\"";
    body += code;
    body += "\",\"error\":\"";
    body += msg;
    body += "\"}";
    return http_send_json(req, body.c_str());
}

// Shared test-before-persist gate for the standalone compatibility endpoint and the integrated
// Board Hardware form. The caller owns the one eventual config_save(), so a failed sensor probe can
// never leave board identity/peripherals saved while ENV III stayed behind (or vice versa).
static esp_err_t env3_save_preflight(httpd_req_t* req, const Config& current,
                                     const Config& proposed, bool& allowed) {
    allowed = false;
    std::string reason;
    if (!env3_config_valid(proposed, reason, SOC_GPIO_PIN_COUNT - 1, hw_octal_spi())) {
        return send_err(req, "400 Bad Request", reason.c_str());
    }
    switch (env3_save_check(current, proposed)) {
        case Env3SaveCheck::None:
            allowed = true;  // disabling is the recovery path and never needs attached hardware
            return ESP_OK;
        case Env3SaveCheck::RunningSample: {
            const Env3Status status = env3_status();
            if (status.connected && status.fresh) { allowed = true; return ESP_OK; }
            return send_env3_err(req, "422 Unprocessable Entity", "env3_not_reachable",
                                 "ENV III is not currently reachable on the selected SDA/SCL pins");
        }
        case Env3SaveCheck::HardwareProbe:
            switch (env3_probe(proposed.env3_sda, proposed.env3_scl)) {
                case Env3ProbeResult::Ok:
                    allowed = true;
                    return ESP_OK;
                case Env3ProbeResult::BusUnavailable:
                    return send_env3_err(req, "503 Service Unavailable", "env3_probe_busy",
                                         "The I2C probe could not start; retry the save");
                case Env3ProbeResult::Sht30Unavailable:
                    return send_env3_err(req, "422 Unprocessable Entity", "env3_sht30_not_found",
                                         "ENV III temperature/humidity sensor not found on the selected pins");
                case Env3ProbeResult::Qmp6988Unavailable:
                    return send_env3_err(req, "422 Unprocessable Entity", "env3_qmp6988_not_found",
                                         "ENV III pressure sensor not found on the selected pins");
            }
            return ESP_FAIL;
        case Env3SaveCheck::DisableFirst:
            return send_env3_err(req, "409 Conflict", "env3_disable_first",
                                 "Disable ENV III before changing its SDA/SCL pins");
    }
    return ESP_FAIL;
}

static const char* js(cJSON* o, const char* k, const char* def = "") {
    cJSON* v = cJSON_GetObjectItem(o, k);
    return (v && cJSON_IsString(v)) ? v->valuestring : def;
}
static int ji(cJSON* o, const char* k, int def) {
    cJSON* v = cJSON_GetObjectItem(o, k);
    return (v && cJSON_IsNumber(v)) ? v->valueint : def;
}
static bool jb(cJSON* o, const char* k, bool def) {
    cJSON* v = cJSON_GetObjectItem(o, k);
    return cJSON_IsBool(v) ? cJSON_IsTrue(v) : def;
}

static esp_err_t set_wifi(httpd_req_t* req) {
    char body[512];
    if (http_read_body(req, body, sizeof(body)) < 0) return send_err(req, "400 Bad Request", "bad body");
    cJSON* j = cJSON_Parse(body);
    if (!j) return send_err(req, "400 Bad Request", "bad json");
    std::string ssid = js(j, "ssid");
    std::string pass = js(j, "pass");
    std::string reason;
    if (!wifi_credentials_valid(ssid, pass, reason)) {
        cJSON_Delete(j);
        return send_err(req, "400 Bad Request", reason.c_str());
    }
    Config c = config();
    if (!c.wifi_ssid.empty()) {
        c.wifi_ssid_backup = c.wifi_ssid;
        c.wifi_pass_backup = c.wifi_pass;
        c.wifi_rollback_active = true;
    } else {
        c.wifi_ssid_backup = "";
        c.wifi_pass_backup = "";
        c.wifi_rollback_active = false;
    }
    // A fresh attempt retires the previous one's verdict: /status.wifi.rolled_back describes the
    // change being replaced here, so leaving it set would keep reporting a rollback the user has
    // already seen and acted on.
    c.wifi_rolled_back = false;
    c.wifi_ssid = ssid;
    c.wifi_pass = pass;
    cJSON_Delete(j);
    // A failed save leaves NVS *and* RAM on the old credentials, so rebooting would silently drop
    // the user back onto the old network behind an {"ok":true} — say so and stay up instead.
    if (!config_save(c)) {
        httpd_resp_set_status(req, "500 Internal Server Error");
        return http_send_json(req, "{\"ok\":false,\"error\":\"config write failed\"}");
    }
    http_send_json(req, "{\"ok\":true,\"reboot\":true}");
    reboot_soon();
    return ESP_OK;
}

// ── /set_mqtt broker pre-flight ──────────────────────────────────────────────────────────────────
// Unlike /set_wifi and /set_syslog (which persist + reboot and let the boot path surface failures),
// /set_mqtt VALIDATES the broker synchronously on the request thread before persisting: DNS ->
// TCP-port probe -> a short-lived esp-mqtt client that must actually CONNECT (and authenticate, when
// creds are given). This turns a wrong host / closed port / bad password into an inline error at Save
// instead of a silent post-reboot failure. It mirrors mqtt_ha.cpp build_client()'s scheme/credential
// policy (creds require mqtts://) so the pre-flight and the real bridge agree.
//
// Cost & safety: the handler blocks up to ~3 s (TCP probe) + ~5 s (MQTT connect) — acceptable for a
// user-initiated Save, and it runs under http_common.cpp's handle_all try/catch (an OOM throw becomes
// a 503, not a crash). The temp client uses a distinct client_id ("daikin_val") so it never collides
// with the live bridge. A TLS broker spins up a transient mbedTLS session; on this heap-tight target
// that is the main memory cost of the probe, released as soon as the client is destroyed.
struct MqttValidateCtx {
    SemaphoreHandle_t sem;
    bool connected;
    const char* error_msg;   // string LITERAL only — assigning it in the callback must never allocate
                             // (the callback runs on esp-mqtt's task, outside handle_all's try/catch)
};

// esp-mqtt event callback, runs on the temp client's task. Hands the request thread its verdict via
// `sem`: CONNECTED -> success; the first DISCONNECTED before a connect -> failure (a preceding ERROR
// leaves a human-readable reason in `error_msg`). The give/take pair also publishes error_msg safely
// across the two tasks; esp_mqtt_client_stop() (below) joins this task before the ctx goes out of
// scope. error_msg is a `const char*` to a string literal on purpose: this runs off the http worker
// thread, so it must not throw — a std::string assignment could hit bad_alloc and unwind through
// esp-mqtt's C frames to abort() (there is no try/catch here, unlike the http handler).
static void on_mqtt_validate(void* handler_args, esp_event_base_t base, int32_t id, void* event_data) {
    auto* ctx = static_cast<MqttValidateCtx*>(handler_args);
    switch (static_cast<esp_mqtt_event_id_t>(id)) {
    case MQTT_EVENT_CONNECTED:
        ctx->connected = true;
        xSemaphoreGive(ctx->sem);
        break;
    case MQTT_EVENT_DISCONNECTED:
        if (!ctx->connected) {
            xSemaphoreGive(ctx->sem);
        }
        break;
    case MQTT_EVENT_ERROR: {
        auto* e = static_cast<esp_mqtt_event_handle_t>(event_data);
        if (e && e->error_handle) {
            if (e->error_handle->error_type == MQTT_ERROR_TYPE_TCP_TRANSPORT) {
                ctx->error_msg = "TLS / TCP connection error";
            } else if (e->error_handle->connect_return_code != MQTT_CONNECTION_ACCEPTED) {
                if (e->error_handle->connect_return_code == MQTT_CONNECTION_REFUSE_BAD_USERNAME ||
                    e->error_handle->connect_return_code == MQTT_CONNECTION_REFUSE_NOT_AUTHORIZED) {
                    ctx->error_msg = "Invalid username or password";
                } else {
                    ctx->error_msg = "Broker refused connection (auth/creds?)";
                }
            }
        }
        // Wake the request thread now with the precise reason rather than waiting for the DISCONNECTED
        // that usually (but not always) follows — otherwise a late DISCONNECTED past the 5 s timeout
        // would surface a generic "connection timeout" and lose the real cause. A double give (this +
        // a later DISCONNECTED) is a harmless no-op on a binary semaphore; connected stays false.
        if (!ctx->connected) xSemaphoreGive(ctx->sem);
        break;
    }
    default: break;
    }
}

static bool tcp_port_probe(const struct in_addr& ip, int port, int timeout_ms) {
    int sock = socket(AF_INET, SOCK_STREAM, IPPROTO_IP);
    if (sock < 0) return false;

    int flags = fcntl(sock, F_GETFL, 0);
    fcntl(sock, F_SETFL, flags | O_NONBLOCK);

    struct sockaddr_in addr{};
    addr.sin_family = AF_INET;
    addr.sin_port = htons(port);
    addr.sin_addr = ip;

    int ret = connect(sock, (struct sockaddr*)&addr, sizeof(addr));
    if (ret < 0) {
        if (errno == EINPROGRESS) {
            fd_set fdsw;
            FD_ZERO(&fdsw);
            FD_SET(sock, &fdsw);
            struct timeval tv{};
            tv.tv_sec = timeout_ms / 1000;
            tv.tv_usec = (timeout_ms % 1000) * 1000;
            ret = select(sock + 1, nullptr, &fdsw, nullptr, &tv);
            if (ret > 0) {
                int valopt = 0;
                socklen_t lon = sizeof(int);
                if (getsockopt(sock, SOL_SOCKET, SO_ERROR, &valopt, &lon) == 0) {
                    if (valopt == 0) {
                        close(sock);
                        return true;
                    }
                }
            }
        }
    } else {
        close(sock);
        return true;
    }
    close(sock);
    return false;
}

static esp_err_t set_mqtt(httpd_req_t* req) {
    char body[512];
    if (http_read_body(req, body, sizeof(body)) < 0) return send_err(req, "400 Bad Request", "bad body");
    cJSON* j = cJSON_Parse(body);
    if (!j) return send_err(req, "400 Bad Request", "bad json");
    std::string broker      = js(j, "broker");
    std::string user        = js(j, "user");
    std::string pass        = js(j, "pass");
    const bool  clear_creds = jb(j, "clear_creds", false);
    cJSON_Delete(j);

    Config c = config();
    // The modal never prefills credentials (/status deliberately doesn't expose them), so the fields
    // come back empty whenever the user didn't retype them. An empty user AND pass therefore means
    // "keep the stored credentials" — NOT "clear them". Without this, editing only the broker would
    // silently wipe a working username/password (and the pre-flight below would connect anonymously
    // and either destroy the creds or reject a broker the real creds would have accepted).
    //
    // That default alone left NO way to clear them: disabling MQTT and re-adding the broker both
    // arrive with empty creds, so both KEEP — and every later plain mqtt:// save is then rejected
    // "Credentials require mqtts://" by the kept creds. Migrating an authenticated mqtts:// broker to
    // an anonymous one needed a flash erase. `clear_creds:true` (the modal's "remove stored
    // credentials" checkbox) is the explicit signal for the other meaning of empty. A non-empty
    // user/pass is an explicit SET and wins regardless — the flag only disambiguates the empty case.
    if (user.empty() && pass.empty() && !clear_creds) {
        user = c.mqtt_user;
        pass = c.mqtt_pass;
    }
    if (broker == c.mqtt_uri && user == c.mqtt_user && pass == c.mqtt_pass) {
        return http_send_json(req, "{\"ok\":true,\"reboot\":false}");
    }

    if (!broker.empty()) {
        // 1. WiFi connectivity check
        if (!wifi_info().connected) {
            httpd_resp_set_status(req, "400 Bad Request");
            return http_send_json(req, "{\"ok\":false,\"error\":\"WiFi not connected\"}");
        }

        // 2. Validate scheme / credentials leakage policy
        std::string test_uri = broker;
        const bool has_scheme = test_uri.find("://") != std::string::npos;
        const bool is_tls_check = test_uri.rfind("mqtts://", 0) == 0 || test_uri.rfind("wss://", 0) == 0;
        const bool has_creds = !user.empty() || !pass.empty();
        if (!has_scheme) test_uri = "mqtt://" + test_uri;

        if (has_creds && !is_tls_check) {
            httpd_resp_set_status(req, "400 Bad Request");
            return http_send_json(req, "{\"ok\":false,\"error\":\"Credentials require mqtts://\"}");
        }

        // 3. Parse host and port
        std::string host;
        int port = 0;
        bool is_tls = false;
        const char* uri_err = "Invalid broker URI";
        if (!parse_mqtt_uri(test_uri, host, port, is_tls, &uri_err)) {
            httpd_resp_set_status(req, "400 Bad Request");
            return http_send_json(req, (std::string("{\"ok\":false,\"error\":\"") + uri_err + "\"}").c_str());
        }

        // 4. Resolve DNS
        struct addrinfo hints{}, *res = nullptr;
        hints.ai_family = AF_INET;
        hints.ai_socktype = SOCK_STREAM;
        char port_str[16];
        std::snprintf(port_str, sizeof(port_str), "%d", port);
        int err = getaddrinfo(host.c_str(), port_str, &hints, &res);
        if (err != 0 || res == nullptr) {
            httpd_resp_set_status(req, "400 Bad Request");
            return http_send_json(req, "{\"ok\":false,\"error\":\"DNS lookup failed\"}");
        }
        struct sockaddr_in target_addr;
        std::memcpy(&target_addr, res->ai_addr, sizeof(struct sockaddr_in));
        freeaddrinfo(res);

        // 5. TCP connection probe
        if (!tcp_port_probe(target_addr.sin_addr, port, 3000)) {
            httpd_resp_set_status(req, "400 Bad Request");
            return http_send_json(req, "{\"ok\":false,\"error\":\"Broker port unreachable\"}");
        }

        // 6. Connect and authenticate with credentials — but only if the heap can afford it.
        // A TLS client spins up a full mbedTLS session (~16 KB in-buf + 4 KB out-buf, each ONE
        // contiguous block) ON TOP of the live bridge's own session. On a fragmented heap that second
        // session can exceed the largest free block and reboot the device. If we can't fit it, reject
        // this attempt WITHOUT persisting and let the UI offer a retry. DNS + an open TCP port do not
        // prove MQTT CONNECT/authentication; saving after only those two checks would break this
        // endpoint's test-before-persist contract. Threshold is generous for the TLS case.
        const size_t need = is_tls ? 48u * 1024u : 12u * 1024u;
        MqttValidateCtx ctx{};                       // error_msg zero-inits to nullptr
        ctx.sem = xSemaphoreCreateBinary();
        if (!ctx.sem || heap_caps_get_largest_free_block(MALLOC_CAP_DEFAULT) < need) {
            if (ctx.sem) vSemaphoreDelete(ctx.sem);
            diag_printf("mqtt: broker connect probe deferred: insufficient contiguous heap; not saving\n");
            return send_err(req, "503 Service Unavailable", "Device busy; retry MQTT verification");
        }

        esp_mqtt_client_config_t cfg = {};
        cfg.broker.address.uri = test_uri.c_str();
        if (is_tls) cfg.broker.verification.crt_bundle_attach = esp_crt_bundle_attach;
        cfg.credentials.client_id = "daikin_val";
        if (!user.empty()) cfg.credentials.username = user.c_str();
        if (!pass.empty()) cfg.credentials.authentication.password = pass.c_str();
        cfg.session.keepalive = 15;

        esp_mqtt_client_handle_t client = esp_mqtt_client_init(&cfg);
        if (!client) {
            vSemaphoreDelete(ctx.sem);
            httpd_resp_set_status(req, "500 Internal Server Error");
            return http_send_json(req, "{\"ok\":false,\"error\":\"MQTT init failed\"}");
        }

        esp_mqtt_client_register_event(client, static_cast<esp_mqtt_event_id_t>(MQTT_EVENT_ANY),
                                       on_mqtt_validate, &ctx);

        // A failed start never produces an event, so waiting on the semaphore would burn the full
        // 5 s and then blame a "connection timeout" — report the real cause immediately instead.
        // No stop() here: nothing was started.
        if (esp_mqtt_client_start(client) != ESP_OK) {
            esp_mqtt_client_destroy(client);
            vSemaphoreDelete(ctx.sem);
            httpd_resp_set_status(req, "500 Internal Server Error");
            return http_send_json(req, "{\"ok\":false,\"error\":\"MQTT client start failed\"}");
        }

        bool finished = xSemaphoreTake(ctx.sem, pdMS_TO_TICKS(5000)) == pdTRUE;

        esp_mqtt_client_stop(client);       // joins the mqtt task -> the callback can't touch ctx after this
        esp_mqtt_client_destroy(client);
        vSemaphoreDelete(ctx.sem);

        if (!finished) {
            httpd_resp_set_status(req, "400 Bad Request");
            return http_send_json(req, "{\"ok\":false,\"error\":\"MQTT connection timeout\"}");
        }
        if (!ctx.connected) {
            // error_msg is a string literal by construction (see MqttValidateCtx) — never broker
            // text, so it satisfies send_err's no-escaping precondition.
            return send_err(req, "400 Bad Request", ctx.error_msg ? ctx.error_msg : "MQTT connection refused");
        }
    }

    c = config();
    c.mqtt_uri  = broker;
    c.mqtt_user = user;
    c.mqtt_pass = pass;
    // The broker just pre-flighted clean, so a failure here is NVS, not the user's input — don't
    // reboot into the old broker while telling them the new one was accepted.
    if (!config_save(c)) {
        httpd_resp_set_status(req, "500 Internal Server Error");
        return http_send_json(req, "{\"ok\":false,\"error\":\"config write failed\"}");
    }
    http_send_json(req, "{\"ok\":true,\"reboot\":true}");
    reboot_soon();
    return ESP_OK;
}

struct RefTempRequest {
    std::string name, topic, path, setpoint_path, time_path, enabled_path, hvac_mode_path;
    uint32_t max_age_s = REF_TEMP_MAX_AGE_DEFAULT_S;
    uint32_t test_proof = 0;
};

// Parse Test and Save through one contract. Otherwise the most important guarantee in this dialog
// could drift: the candidate that earned the proof would not necessarily be the mapping persisted.
static const char* parse_ref_temp_request(httpd_req_t* req, RefTempRequest& out) {
    char body[1536];
    if (http_read_body(req, body, sizeof(body)) < 0) return "bad body";
    cJSON* j = cJSON_Parse(body);
    if (!j) return "bad json";
    out.name      = js(j, "name");
    out.topic     = js(j, "topic");
    out.path      = js(j, "temperature_path");
    out.setpoint_path = js(j, "setpoint_path");
    out.time_path = js(j, "timestamp_path");
    out.enabled_path = js(j, "enabled_path");
    out.hvac_mode_path = js(j, "hvac_mode_path");
    cJSON* age_item = cJSON_GetObjectItem(j, "max_age_s");
    const bool age_type_valid = !age_item || (cJSON_IsNumber(age_item) &&
                                age_item->valuedouble == static_cast<double>(age_item->valueint));
    out.max_age_s = age_item && cJSON_IsNumber(age_item)
                  ? static_cast<uint32_t>(age_item->valueint)
                  : REF_TEMP_MAX_AGE_DEFAULT_S;
    cJSON* proof_item = cJSON_GetObjectItem(j, "test_proof");
    const bool proof_type_valid = !proof_item || (cJSON_IsNumber(proof_item) &&
                                   proof_item->valuedouble >= 0 &&
                                   proof_item->valuedouble <= 2147483647.0 &&
                                   proof_item->valuedouble == std::floor(proof_item->valuedouble));
    if (proof_type_valid && proof_item)
        out.test_proof = static_cast<uint32_t>(proof_item->valuedouble);
    cJSON_Delete(j);

    if (!age_type_valid) return "Maximum age must be a whole number";
    if (!proof_type_valid) return "Test proof must be a whole number";
    if (out.topic.empty()) {                             // empty topic is the explicit Off state
        out.path.clear();
        out.setpoint_path.clear();
        out.time_path.clear();
        out.enabled_path.clear();
        out.hvac_mode_path.clear();
    }
    if (!out.topic.empty() && out.setpoint_path.empty()) return "Setpoint JSON path is required";
    if (!out.topic.empty() && out.time_path.empty()) return "Timestamp JSON path is required";
    const char* why = nullptr;
    if (!reference_temperature_config_valid(out.name, out.topic, out.path, out.setpoint_path,
                                            out.time_path, out.enabled_path, out.hvac_mode_path,
                                            out.max_age_s, &why))
        return why ? why : "invalid reference temperature config";
    return nullptr;
}

static ReferenceTemperatureTestConfig ref_temp_test_config(const RefTempRequest& in) {
    return {in.topic, in.path, in.setpoint_path, in.time_path,
            in.enabled_path, in.hvac_mode_path, in.max_age_s};
}

// Test on the already-authenticated live MQTT connection. Nothing in Config or NVS changes here;
// a successful response hands the browser a one-mapping proof that /set_ref_temp checks again.
static esp_err_t test_ref_temp(httpd_req_t* req) {
    RefTempRequest in;
    if (const char* error = parse_ref_temp_request(req, in))
        return send_err(req, "400 Bad Request", error);
    if (in.topic.empty()) return send_err(req, "400 Bad Request", "MQTT topic is required for a test");

    const ReferenceTemperatureTestResult result = mqtt_reference_test(
        ref_temp_test_config(in), 12000);
    if (!result.passed)
        return send_err(req, "422 Unprocessable Entity",
                        result.error.empty() ? "No fresh MQTT value received" : result.error.c_str());

    char response[384];
    std::snprintf(response, sizeof(response),
                  "{\"ok\":true,\"test_proof\":%lu,\"temperature_c\":%.6g,"
                  "\"setpoint_c\":%.6g,\"control_eligible\":%s,\"room_error_k\":%s,"
                  "\"reason\":\"%s\",\"reason_code\":%u,\"retained\":%s}",
                  static_cast<unsigned long>(result.proof), result.temperature_c, result.setpoint_c,
                  result.control_eligible ? "true" : "false",
                  result.control_eligible ? std::to_string(result.room_error_k).c_str() : "null",
                  reference_room_reason_name(result.reason), static_cast<unsigned>(result.reason),
                  result.retained ? "true" : "false");
    return http_send_json(req, response);
}

// Decision-ready, read-only room source. The mapping + freshness policy apply live on the existing
// MQTT connection and feed only the write-free SHADOW controller. A non-empty mapping cannot reach
// Config/NVS until this exact topic/path/age tuple produced a fresh value.
static esp_err_t set_ref_temp(httpd_req_t* req) {
    RefTempRequest in;
    if (const char* error = parse_ref_temp_request(req, in))
        return send_err(req, "400 Bad Request", error);

    const ReferenceTemperatureTestConfig tested = ref_temp_test_config(in);
    if (!in.topic.empty() && !mqtt_reference_test_proof_valid(in.test_proof, tested))
        return send_err(req, "409 Conflict", "Test this MQTT mapping successfully before saving");

    Config c = config();
    if (c.ref_temp_name == in.name && c.ref_temp_topic == in.topic && c.ref_temp_path == in.path &&
        c.ref_temp_setpoint_path == in.setpoint_path && c.ref_temp_time_path == in.time_path &&
        c.ref_temp_enabled_path == in.enabled_path &&
        c.ref_temp_hvac_mode_path == in.hvac_mode_path &&
        c.ref_temp_max_age_s == in.max_age_s) {
        mqtt_reference_reconfigure();                 // consume the proof + retry the saved mapping
        return http_send_json(req, "{\"ok\":true,\"saved\":false,\"reboot\":false}");
    }
    c.ref_temp_name = in.name;
    c.ref_temp_topic = in.topic;
    c.ref_temp_path = in.path;
    c.ref_temp_setpoint_path = in.setpoint_path;
    c.ref_temp_time_path = in.time_path;
    c.ref_temp_enabled_path = in.enabled_path;
    c.ref_temp_hvac_mode_path = in.hvac_mode_path;
    c.ref_temp_max_age_s = in.max_age_s;
    if (!config_save(c)) return send_err(req, "500 Internal Server Error", "config write failed");
    mqtt_reference_reconfigure();
    diag_printf("mqtt: reference temperature mapping saved%s\n", in.topic.empty() ? " (disabled)" : "");
    return http_send_json(req, "{\"ok\":true,\"saved\":true,\"reboot\":false}");
}

// WP2's only controller setting. The accepted vocabulary intentionally ends at SHADOW: there is no
// ACTIVE value to typo into or reach through a raw HTTP request, and this handler has no actuator
// dependency. Applied live by the next mqtt-task evaluation; no reboot.
static esp_err_t set_dynamic_lwt(httpd_req_t* req) {
    char body[128];
    if (http_read_body(req, body, sizeof(body)) < 0)
        return send_err(req, "400 Bad Request", "bad body");
    cJSON* j = cJSON_Parse(body);
    if (!j) return send_err(req, "400 Bad Request", "bad json");
    const std::string mode = js(j, "mode");
    cJSON_Delete(j);

    logic::DynamicLwtMode want = logic::DynamicLwtMode::Off;
    if (!logic::dynamic_lwt_mode_parse(mode.c_str(), want))
        return send_err(req, "400 Bad Request", "mode must be off or shadow");

    Config c = config();
    if (want == logic::DynamicLwtMode::Shadow && !dynamic_lwt_shadow_ready(c)) {
        return send_err(req, "409 Conflict",
                        "shadow requires configured MQTT room input and HomeHub");
    }
    if (c.dynamic_lwt_mode == want)
        return http_send_json(req, "{\"ok\":true,\"saved\":false,\"reboot\":false}");
    c.dynamic_lwt_mode = want;
    if (!config_save(c)) return send_err(req, "500 Internal Server Error", "config write failed");
    // Apply the consent boundary now, not after either worker's normal sleep interval. OFF removes
    // the saved room subscription and pauses Open-Meteo; SHADOW starts both on their next cycle.
    mqtt_reference_reconfigure();
    weather_forecast_reconfigure();
    if (want == logic::DynamicLwtMode::Off) mqtt_request_weather_cleanup();
    diag_printf("dynamic_lwt: mode set to %s (shadow never calls actuator)\n",
                logic::dynamic_lwt_mode_name(want));
    return http_send_json(req, "{\"ok\":true,\"saved\":true,\"reboot\":false}");
}

static esp_err_t set_hp(httpd_req_t* req) {
    char body[2048];
    if (http_read_body(req, body, sizeof(body)) < 0) return send_err(req, "400 Bad Request", "bad body");
    cJSON* j = cJSON_Parse(body);
    if (!j) return send_err(req, "400 Bad Request", "bad json");
    Config c    = config();
    const bool modbus_was_enabled = config_modbus_enabled(c);
    const std::string old_mb_host = c.mb_host;
    const int old_mb_port = c.mb_port;
    const int old_mb_unit = c.mb_unit_id;
    // The RX/TX pins are the physical X10A wiring: PERSISTED so a manual override survives a reboot
    // (config_save below). The model "profile" is session-only — only touched when the request
    // explicitly sends "profile"; a wiring-only patch omits it so it does not re-select the model or
    // invalidate a settled fingerprint (which would force a spurious re-detect next poll).
    cJSON* profItem     = cJSON_GetObjectItem(j, "profile");
    bool   profile_sent = cJSON_IsString(profItem);
    const int old_rx = c.rx_pin;
    const int old_tx = c.tx_pin;
    // "auto" (the UI's only value) requests a fresh detection; a concrete id pins the model for this
    // session (accepted for API flexibility, never offered in the UI).
    if (profile_sent) c.profile = profItem->valuestring;
    if (set_hp_clears_fingerprint(profile_sent, c.profile)) c.fp_valid = false;
    // proto is auto-detected (hp_detect.cpp), not set from the UI.
    c.rx_pin    = ji(j, "rx", c.rx_pin);
    c.tx_pin    = ji(j, "tx", c.tx_pin);
    const bool reset_checkup =
        set_hp_resets_checkup(profile_sent, old_rx, old_tx, c.rx_pin, c.tx_pin);
    // The HomeHub Modbus stack (issue #32). All optional — an omitted key keeps its stored value, so
    // a wiring-only patch (rx/tx) leaves the HomeHub untouched and the pin picker's
    // {profile:"auto",rx,tx} POST cannot switch anything on. This is a SECOND source, not an
    // alternative to X10A: enabling it starts a separate task, it does not stop the X10A poll.
    // HomeHub configuration has one unambiguous switch: a non-empty address enables polling; an
    // empty address disables the stack and causes no discovery or HomeHub request. Discovery is a
    // separate, explicit /discover_homehub action which only returns an address for the dialog; it
    // never mutates config behind the form's Save/Cancel boundary.
    cJSON* hostItem = cJSON_GetObjectItem(j, "mb_host");
    const bool host_sent = cJSON_IsString(hostItem);
    if (host_sent) c.mb_host = hostItem->valuestring;
    c.mb_port           = ji(j, "mb_port", c.mb_port);
    c.mb_unit_id        = ji(j, "mb_unit_id", c.mb_unit_id);
    // `actuation_enabled` is deliberately NOT accepted: the register-54 write path is retired (#294)
    // and an accepted-but-inert field would read like a capability that still exists.
    const bool reset_mb_history = homehub_history_identity_changed(
        old_mb_host, old_mb_port, old_mb_unit, c.mb_host, c.mb_port, c.mb_unit_id);
    cJSON_Delete(j);
    std::string reason;
    // Pass the real Kconfig-derived octal-SPI + status-LED facts (config.cpp) so validate() rejects a
    // chip-reserved GPIO — a flash/strapping/JTAG pad the UI dropdown never offers but a raw curl POST
    // could send — with the pin named, instead of range-accepting it and persisting a crash-loop pair.
    if (!validate(c, reason, SOC_GPIO_PIN_COUNT - 1, hw_octal_spi(), config_reserved_pins(c)))
        return send_err(req, "400 Bad Request", reason.c_str());
    // This route OWNS the pin cache, unlike the service routes whose link writes are only
    // best-effort maintenance. Require all three cache keys; on failure RAM stays untouched, so
    // there is no new link to hand the poll engine and reconfigure must be skipped.
    if (!config_save(c, /*require_link=*/true))
        return send_err(req, "500 Internal Server Error", "config write failed");
    if (modbus_was_enabled && !config_modbus_enabled(c)) mqtt_request_modbus_cleanup();
    if (reset_checkup) {
        checkup_reset();
        history_reset();
        hp_poll_reconfigure();
    }
    if (reset_mb_history) history_modbus_reset();
    // The HomeHub stack is told separately, because it IS separate: this starts or stops its task
    // and re-resolves its address without touching the X10A poll engine above.
    mb_reconfigure();
    return http_send_json(req, "{\"ok\":true}");
}

// Explicit HomeHub discovery for the edit dialog. This is intentionally NOT part of boot or of the
// Modbus poll task, and it does not save anything: the user sees the found IPv4 in the normal host
// field and decides with Save or Cancel whether it becomes configuration. A bounded miss returns
// control to that same field for manual entry.
static esp_err_t discover_homehub_now(httpd_req_t* req) {
    if (!wifi_info().connected)
        return send_err(req, "400 Bad Request", "WiFi not connected");
    std::string found;
    if (!mb_discover_homehub(found))
        return send_err(req, "404 Not Found", "No HomeHub found");
    // mb_discover_homehub returns a numeric IPv4 assembled by firmware, never caller text.
    const std::string body = std::string("{\"ok\":true,\"host\":\"") + found + "\"}";
    return http_send_json(req, body.c_str());
}

static esp_err_t set_syslog(httpd_req_t* req) {
    char body[512];
    if (http_read_body(req, body, sizeof(body)) < 0) return send_err(req, "400 Bad Request", "bad body");
    cJSON* j = cJSON_Parse(body);
    if (!j) return send_err(req, "400 Bad Request", "bad json");
    std::string host = js(j, "host");
    int port = ji(j, "port", 514);
    cJSON_Delete(j);

    // Only the port range is validated synchronously (cheap). DNS resolution + reachability are done
    // asynchronously by the syslog task and surfaced via /status.syslog {resolved, reachable, error},
    // so the request path never blocks on a network probe. (/set_mqtt is the deliberate exception: it
    // pre-flights the broker connect synchronously so a bad address/credential is rejected at Save
    // rather than silently failing after the reboot — syslog is fire-and-forget UDP, MQTT is not.)
    if (!host.empty() && (port < 1 || port > 65535)) {
        httpd_resp_set_status(req, "400 Bad Request");
        return http_send_json(req, "{\"ok\":false,\"error\":\"port out of range\"}");
    }

    Config c = config();
    // Unchanged settings short-circuit — no NVS write, no reboot — exactly like /set_mqtt and
    // /set_ntp. A re-save of the same host/port would otherwise persist identical values and reboot,
    // dropping the poll cycle, MQTT availability and any open WebSocket for nothing. The UI already
    // handles {"reboot":false} (www/js/settings.js "No changes"). /set_wifi is deliberately NOT short-circuited:
    // a re-save there re-arms the credential-rollback trial.
    if (host == c.syslog_host && port == c.syslog_port)
        return http_send_json(req, "{\"ok\":true,\"reboot\":false}");
    c.syslog_host = host;
    c.syslog_port = port;
    if (!config_save(c)) {
        httpd_resp_set_status(req, "500 Internal Server Error");
        return http_send_json(req, "{\"ok\":false,\"error\":\"config write failed\"}");
    }
    http_send_json(req, "{\"ok\":true,\"reboot\":true}");
    reboot_soon();
    return ESP_OK;
}

// POST /set_ntp {server} -> persist + reboot, mirroring /set_syslog: no request-path network probe
// (the SNTP client resolves + retries on its own task after reboot), an empty server is accepted —
// config_load() reads it as "reset to the CONFIG_DAIKIN_NTP_SERVER compile-time default" — and the
// only validation here is the same shape a hostname/IP field ever gets in this codebase (none; the
// SNTP client itself just fails to resolve a garbage name and keeps retrying, same as a bad syslog
// host does today).
static esp_err_t set_ntp(httpd_req_t* req) {
    char body[256];
    if (http_read_body(req, body, sizeof(body)) < 0) return send_err(req, "400 Bad Request", "bad body");
    cJSON* j = cJSON_Parse(body);
    if (!j) return send_err(req, "400 Bad Request", "bad json");
    std::string server = js(j, "server");
    cJSON_Delete(j);

    Config c = config();
    if (server == c.ntp_server) return http_send_json(req, "{\"ok\":true,\"reboot\":false}");
    c.ntp_server = server;
    if (!config_save(c)) {
        httpd_resp_set_status(req, "500 Internal Server Error");
        return http_send_json(req, "{\"ok\":false,\"error\":\"config write failed\"}");
    }
    http_send_json(req, "{\"ok\":true,\"reboot\":true}");
    reboot_soon();
    return ESP_OK;
}

// POST /set_weather {latitude, longitude}. Two empty strings disable weather traffic; otherwise both
// strict decimal coordinates are required. Saving is local and non-blocking: the dedicated weather
// task performs TLS/DNS/JSON work only after this response.
static esp_err_t set_weather(httpd_req_t* req) {
    char body[192];
    if (http_read_body(req, body, sizeof(body)) < 0) return send_err(req, "400 Bad Request", "bad body");
    cJSON* j = cJSON_Parse(body);
    if (!j) return send_err(req, "400 Bad Request", "bad json");
    const std::string latitude = js(j, "latitude");
    const std::string longitude = js(j, "longitude");
    cJSON_Delete(j);
    const WeatherLocationParse location = weather_location_parse(latitude, longitude);
    if (!location.valid) {
        if (std::strcmp(location.reason, "both_coordinates_required") == 0)
            return send_err(req, "400 Bad Request", "latitude and longitude are both required");
        if (std::strcmp(location.reason, "invalid_latitude") == 0)
            return send_err(req, "400 Bad Request", "latitude must be between -90 and 90");
        return send_err(req, "400 Bad Request", "longitude must be between -180 and 180");
    }
    Config c = config();
    const bool weather_was_enabled = c.weather_enabled;
    if (location.enabled == c.weather_enabled &&
        location.latitude_e6 == c.weather_latitude_e6 &&
        location.longitude_e6 == c.weather_longitude_e6)
        return http_send_json(req, "{\"ok\":true,\"reboot\":false}");
    c.weather_enabled = location.enabled;
    c.weather_latitude_e6 = location.latitude_e6;
    c.weather_longitude_e6 = location.longitude_e6;
    if (!config_save(c)) return send_err(req, "500 Internal Server Error", "config write failed");
    if (weather_was_enabled && !location.enabled) mqtt_request_weather_cleanup();
    weather_forecast_reconfigure();
    return http_send_json(req, "{\"ok\":true,\"reboot\":false,\"saved\":true}");
}

// POST /set_board {preset_id, led_gpio, led_type, led_inverted, btn_gpio, btn_active_low,
//                  env3_enabled, env3_sda, env3_scl} -> validate + persist + optional reboot.
// This one atomic form owns the board identity, its configurable local peripherals and the optional
// M5Stack ENV III accessory. Keeping them in one request means selecting AtomS3 Lite and attaching
// its Grove sensor cannot save only half of the intended configuration.
//
// Unlike /set_hp (which applies pins live), this REBOOTS. Both settings are claimed once at task
// start: the indicator opens an RMT channel for a WS2812, the button installs a pull on its pin.
// Hot-swapping either means tearing down a running driver from a different task while it blinks —
// a whole class of failure bought for nothing, since changing an indicator pin is a once-per-board
// action. A reboot is also what the four service endpoints already do, so the UI path is identical.
static esp_err_t set_board(httpd_req_t* req) {
    char body[512];
    if (http_read_body(req, body, sizeof(body)) < 0) return send_err(req, "400 Bad Request", "bad body");
    cJSON* j = cJSON_Parse(body);
    if (!j) return send_err(req, "400 Bad Request", "bad json");
    const Config& cur = config();
    Config c = cur;
    c.led_gpio       = ji(j, "led_gpio", c.led_gpio);
    c.led_type       = ji(j, "led_type", c.led_type);
    c.led_inverted   = jb(j, "led_inverted", c.led_inverted);
    c.btn_gpio       = ji(j, "btn_gpio", c.btn_gpio);
    c.btn_active_low = jb(j, "btn_active_low", c.btn_active_low);
    c.env3_enabled   = jb(j, "env3_enabled", c.env3_enabled);
    c.env3_sda       = ji(j, "env3_sda", c.env3_sda);
    c.env3_scl       = ji(j, "env3_scl", c.env3_scl);
    cJSON* preset_item = cJSON_GetObjectItem(j, "preset_id");
    if (preset_item && !cJSON_IsString(preset_item)) {
        cJSON_Delete(j);
        return send_err(req, "400 Bad Request", "preset_id must be a string");
    }
    const bool preset_sent = preset_item != nullptr;
    const std::string preset_key = preset_sent ? preset_item->valuestring : "";
    cJSON_Delete(j);
    // Submitting this form is an explicit board statement. Current clients send the stable key;
    // for a pre-v12 cached UI, recover the same exact-match choice once and persist it explicitly.
    c.board_user_set = true;
    if (!preset_sent) {
        c.board_preset_id = board_legacy_preset_id(c);
    } else if (preset_key == "custom") {
        c.board_preset_id = BoardPresetId::Custom;
    } else {
        const BoardPreset* preset = board_preset_by_key(preset_key);
        if (!preset) return send_err(req, "400 Bad Request", "board preset is unknown");
        c.board_preset_id = preset->id;
    }

    std::string reason;
    if (!board_identity_valid(c, reason))
        return send_err(req, "400 Bad Request", reason.c_str());

    // ENV III is an M5Stack-board feature. Switching to a Seeed or Custom board retires the optional
    // sensor in this same atomic save; its controls disappear as soon as the pending selection is no
    // longer M5Stack, so the server must make the hidden state explicit rather than retain it.
    if (c.env3_enabled && !env3_board_supported(c)) c.env3_enabled = false;

    // Checks the pins against the chip AND against the X10A link in the same snapshot, so neither
    // side can steal the other's GPIO whichever endpoint is called second (logic/config_model.hpp).
    if (!board_hw_valid(c, reason, SOC_GPIO_PIN_COUNT - 1, hw_octal_spi()))
        return send_err(req, "400 Bad Request", reason.c_str());

    bool env_allowed = false;
    const esp_err_t env_result = env3_save_preflight(req, cur, c, env_allowed);
    if (!env_allowed) return env_result;

    // Two independent questions, and answering them with ONE comparison is what made a XIAO owner's
    // save vanish (#257): picking the preset your device already carries moves no VALUE, but it is
    // still the first time anyone stated what this board is. board_save_needed/board_reboot_needed
    // (logic/config_model.hpp, host-tested) keep them apart — persist the statement, but claim no
    // reboot for it, since no driver's pin changed.
    if (!board_env_save_needed(c, cur))
        return http_send_json(req, "{\"ok\":true,\"reboot\":false}");   // nothing to write, no reboot

    if (!config_save(c)) return send_err(req, "500 Internal Server Error", "config write failed");
    // Only the statement moved: persisted, but no driver's pin changed, so no reboot. `saved` is
    // what keeps the ANSWER honest — {"reboot":false} alone makes the UI say "no changes", which
    // would report a write to NVS as nothing having happened. Additive, so the four routes that
    // never send it keep their exact contract.
    if (!board_env_reboot_needed(c, cur))
        return http_send_json(req, "{\"ok\":true,\"reboot\":false,\"saved\":true}");
    http_send_json(req, "{\"ok\":true,\"reboot\":true}");
    reboot_soon();
    return ESP_OK;
}

// POST /set_env3 {enabled,sda,scl}. The I2C driver owns the bus for the life of its task, so a pin
// change is persisted and applied by reboot just like board-local hardware. Disabled is always a
// valid recovery state. Enabling is proof-gated BEFORE config_save(): SHT30 must return a CRC-valid
// measurement and QMP6988 its chip id on the selected pair. Thus a blue Save button cannot persist
// a wiring guess and reboot into a permanently unavailable sensor.
static esp_err_t set_env3(httpd_req_t* req) {
    char body[256];
    if (http_read_body(req, body, sizeof(body)) < 0) return send_err(req, "400 Bad Request", "bad body");
    cJSON* j = cJSON_Parse(body);
    if (!j) return send_err(req, "400 Bad Request", "bad json");
    const Config cur = config();
    Config c = cur;
    c.env3_enabled = jb(j, "enabled", c.env3_enabled);
    c.env3_sda = ji(j, "sda", c.env3_sda);
    c.env3_scl = ji(j, "scl", c.env3_scl);
    cJSON_Delete(j);
    bool env_allowed = false;
    const esp_err_t env_result = env3_save_preflight(req, cur, c, env_allowed);
    if (!env_allowed) return env_result;

    if (env3_config_same(c, cur))
        return http_send_json(req, "{\"ok\":true,\"reboot\":false}");
    if (!config_save(c)) return send_err(req, "500 Internal Server Error", "config write failed");
    http_send_json(req, "{\"ok\":true,\"reboot\":true}");
    reboot_soon();
    return ESP_OK;
}

// POST /set_ota {channel:"release"|"dev"} -> validate + persist, applied LIVE (no reboot).
//
// Which published feed this device follows. Since a merge to main stopped cutting a release, there
// are two: `release` (only a manual CI workflow run tags and publishes one) and `dev` (every
// firmware-relevant merge). See logic/ota_channel.hpp.
//
// No reboot, unlike /set_board: nothing claims the channel at task start — ota_update.cpp reads it
// when it fetches, so the very next check already uses the new feed. An unknown channel name is
// REJECTED rather than defaulted: answering {"ok":true} to a typo would look like a saved setting.
static esp_err_t set_ota(httpd_req_t* req) {
    char body[128];
    if (http_read_body(req, body, sizeof(body)) < 0) return send_err(req, "400 Bad Request", "bad body");
    cJSON* j = cJSON_Parse(body);
    if (!j) return send_err(req, "400 Bad Request", "bad json");
    std::string channel = js(j, "channel");
    cJSON_Delete(j);

    if (!ota_channel_valid(channel)) return send_err(req, "400 Bad Request", "unknown channel");

    Config c = config();
    const OtaChannel want = ota_channel_parse(channel);
    if (want == c.ota_channel) return http_send_json(req, "{\"ok\":true,\"reboot\":false}");
    c.ota_channel = want;
    if (!config_save(c)) return send_err(req, "500 Internal Server Error", "config write failed");
    diag_printf("ota: update channel set to %s\n", ota_channel_name(want));
    return http_send_json(req, "{\"ok\":true,\"reboot\":false}");
}

// The web UI's manual language override. "auto" hands the choice back to the browser (the default);
// "de"/"en" force a language on every client that opens the dashboard. See logic/ui_lang.hpp.
//
// No reboot, like /set_ota: nothing claims the language at task start — the UI reads it from /status,
// so the next poll already applies it. An unknown name is REJECTED rather than defaulted: answering
// {"ok":true} to a typo would look like a saved setting.
static esp_err_t set_lang(httpd_req_t* req) {
    char body[128];
    if (http_read_body(req, body, sizeof(body)) < 0) return send_err(req, "400 Bad Request", "bad body");
    cJSON* j = cJSON_Parse(body);
    if (!j) return send_err(req, "400 Bad Request", "bad json");
    std::string lang = js(j, "lang");
    cJSON_Delete(j);

    if (!ui_lang_valid(lang)) return send_err(req, "400 Bad Request", "unknown language");

    Config c = config();
    const UiLang want = ui_lang_parse(lang);
    if (want == c.ui_lang) return http_send_json(req, "{\"ok\":true,\"reboot\":false}");
    c.ui_lang = want;
    if (!config_save(c)) return send_err(req, "500 Internal Server Error", "config write failed");
    diag_printf("ui: language set to %s\n", ui_lang_name(want));
    return http_send_json(req, "{\"ok\":true,\"reboot\":false}");
}

// Re-run auto-detection now (without waiting for a reboot): drop back to the "auto" sentinel +
// invalidate the fingerprint, so the next poll cycle sweeps protocol + re-fingerprints the unit
// (hp_poll.cpp poll_detect). Detection state is session-only, so this is a RAM-only reset.
static esp_err_t do_detect(httpd_req_t* req) {
    Config c   = config();
    c.profile  = "auto";
    c.fp_valid = false;
    config_set_runtime(c);
    checkup_reset();
    history_reset();
    hp_poll_reconfigure();
    // The HomeHub stack is told separately, because it IS separate: this starts or stops its task
    // and re-resolves its address without touching the X10A poll engine above.
    mb_reconfigure();
    return http_send_json(req, "{\"ok\":true}");
}

void http_register_config(httpd_handle_t s, HttpSurface surface) {
    // /set_wifi is the ONE config route the open setup AP exposes (it is how you provision the
    // network); http_register_on withholds the rest there (F01) — MQTT/syslog/NTP/HP config and
    // re-detect are trusted-LAN only, so a nearby radio client cannot reconfigure the device.
    http_register_on(s, surface, "/set_wifi", HTTP_POST, set_wifi);
    http_register_on(s, surface, "/set_mqtt", HTTP_POST, set_mqtt);
    http_register_on(s, surface, "/test_ref_temp", HTTP_POST, test_ref_temp);
    http_register_on(s, surface, "/set_ref_temp", HTTP_POST, set_ref_temp);
    http_register_on(s, surface, "/set_syslog", HTTP_POST, set_syslog);
    http_register_on(s, surface, "/set_ntp", HTTP_POST, set_ntp);
    http_register_on(s, surface, "/set_weather", HTTP_POST, set_weather);
    http_register_on(s, surface, "/set_dynamic_lwt", HTTP_POST, set_dynamic_lwt);
    http_register_on(s, surface, "/set_hp", HTTP_POST, set_hp);
    http_register_on(s, surface, "/discover_homehub", HTTP_POST, discover_homehub_now);
    http_register_on(s, surface, "/set_board", HTTP_POST, set_board);
    http_register_on(s, surface, "/set_env3", HTTP_POST, set_env3);
    http_register_on(s, surface, "/set_ota", HTTP_POST, set_ota);
    http_register_on(s, surface, "/set_lang", HTTP_POST, set_lang);
    http_register_on(s, surface, "/detect", HTTP_POST, do_detect);
}

} // namespace daik
