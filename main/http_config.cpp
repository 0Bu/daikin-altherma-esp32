// POST config routes: /set_wifi, /set_mqtt, /set_syslog, /set_ntp, /set_hp, /detect. Parse JSON,
// validate, then apply: WiFi/MQTT/syslog/NTP persist to NVS + reboot; /set_hp persists the RX/TX pin
// cache (no reboot) but keeps the model session-only; /detect re-runs detection in RAM.
#include "http_handlers.hpp"
#include "config.hpp"
#include "hp_poll.hpp"
#include "logic/config_model.hpp"
#include "logic/mqtt_uri.hpp"   // parse_mqtt_uri — host/port/TLS split, host-tested

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
                if (e->error_handle->connect_return_code == MQTT_CONNECTION_REFUSE_BAD_USERNAME) {
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
        // session can exceed the largest free block and reboot the device. If we can't fit it, skip the
        // connect probe (DNS + port were already checked) and fall through to persist + reboot — the
        // boot path still surfaces a bad broker via /status.mqtt. Better a save without the deep check
        // than an OOM crash on the request path. Threshold is generous for the TLS case.
        const size_t need = is_tls ? 48u * 1024u : 12u * 1024u;
        MqttValidateCtx ctx{};                       // error_msg zero-inits to nullptr
        ctx.sem = xSemaphoreCreateBinary();
        if (ctx.sem && heap_caps_get_largest_free_block(MALLOC_CAP_DEFAULT) >= need) {
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
        } else {
            if (ctx.sem) vSemaphoreDelete(ctx.sem);
            diag_printf("mqtt: low heap, skipping broker connect probe (DNS+port ok) — saving anyway\n");
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

static esp_err_t set_hp(httpd_req_t* req) {
    char body[2048];
    if (http_read_body(req, body, sizeof(body)) < 0) return send_err(req, "400 Bad Request", "bad body");
    cJSON* j = cJSON_Parse(body);
    if (!j) return send_err(req, "400 Bad Request", "bad json");
    Config c    = config();
    // The RX/TX pins are the physical X10A wiring: PERSISTED so a manual override survives a reboot
    // (config_save below). The model "profile" is session-only — only touched when the request
    // explicitly sends "profile"; a wiring-only patch omits it so it does not re-select the model or
    // invalidate a settled fingerprint (which would force a spurious re-detect next poll).
    cJSON* profItem     = cJSON_GetObjectItem(j, "profile");
    bool   profile_sent = cJSON_IsString(profItem);
    // "auto" (the UI's only value) requests a fresh detection; a concrete id pins the model for this
    // session (accepted for API flexibility, never offered in the UI).
    if (profile_sent) c.profile = profItem->valuestring;
    if (set_hp_clears_fingerprint(profile_sent, c.profile)) c.fp_valid = false;
    // proto is auto-detected (hp_detect.cpp), not set from the UI.
    c.rx_pin    = ji(j, "rx", c.rx_pin);
    c.tx_pin    = ji(j, "tx", c.tx_pin);
    cJSON_Delete(j);

    std::string reason;
    if (!validate(c, reason, SOC_GPIO_PIN_COUNT - 1)) return send_err(req, "400 Bad Request", reason.c_str());
    // Persist the pin cache (config_save writes link+creds; profile/fp stay RAM). On failure RAM is
    // untouched too, so there is no new config to hand the poll engine — skip the reconfigure.
    if (!config_save(c)) return send_err(req, "500 Internal Server Error", "config write failed");
    hp_poll_reconfigure();
    return http_send_json(req, "{\"ok\":true}");
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

// Re-run auto-detection now (without waiting for a reboot): drop back to the "auto" sentinel +
// invalidate the fingerprint, so the next poll cycle sweeps protocol + re-fingerprints the unit
// (hp_poll.cpp poll_detect). Detection state is session-only, so this is a RAM-only reset.
static esp_err_t do_detect(httpd_req_t* req) {
    Config c   = config();
    c.profile  = "auto";
    c.fp_valid = false;
    config_set_runtime(c);
    hp_poll_reconfigure();
    return http_send_json(req, "{\"ok\":true}");
}

void http_register_config(httpd_handle_t s) {
    http_register(s, "/set_wifi", HTTP_POST, set_wifi);
    http_register(s, "/set_mqtt", HTTP_POST, set_mqtt);
    http_register(s, "/set_syslog", HTTP_POST, set_syslog);
    http_register(s, "/set_ntp", HTTP_POST, set_ntp);
    http_register(s, "/set_hp", HTTP_POST, set_hp);
    http_register(s, "/detect", HTTP_POST, do_detect);
}

} // namespace daik
