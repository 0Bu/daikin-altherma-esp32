// Compile the actual /set_mqtt client phase, callback and persistence tail over recording SDK
// adapters. URI/DNS/TCP, real task scheduling, networking and NVS are outside this host witness.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = fs.readFileSync(path.join(root, "main/http_config.cpp"), "utf8");

// Balance C++ braces, skipping strings and comments; ambiguous anchors fail closed.
function extract(anchor) {
  const start = source.indexOf(anchor);
  assert(start >= 0 && source.indexOf(anchor, start + 1) < 0, `unique source anchor: ${anchor}`);
  const opening = source.indexOf("{", start + anchor.length);
  assert(opening >= 0, `source body: ${anchor}`);
  let depth = 0;
  for (let i = opening; i < source.length; i++) {
    const c = source[i];
    if (c === "/" && source[i + 1] === "/") {
      i = source.indexOf("\n", i + 2);
      assert(i >= 0, "unterminated source comment");
    } else if (c === "/" && source[i + 1] === "*") {
      i = source.indexOf("*/", i + 2);
      assert(i >= 0, "unterminated source comment");
      i++;
    } else if (c === '"' || c === "'") {
      assert(!(c === '"' && source[i - 1] === "R"), "raw literals require an extraction update");
      let closed = false;
      for (++i; i < source.length; i++) {
        if (source[i] === "\\") i++;
        else if (source[i] === c) { closed = true; break; }
      }
      assert(closed, "unterminated source literal");
    } else if (c === "{") depth++;
    else if (c === "}" && --depth === 0) return source.slice(start, i + 1);
  }
  assert.fail(`unbalanced source: ${anchor}`);
}

const context = `${extract("struct MqttValidateCtx")}\n;`;
const callback = extract("static void on_mqtt_validate(");
const handler = extract("static esp_err_t set_mqtt(");
const phaseAnchor = "const size_t need = is_tls ?";
const phaseStart = handler.indexOf(phaseAnchor);
assert(phaseStart >= 0 && handler.indexOf(phaseAnchor, phaseStart + 1) < 0,
  "the heap-gated client phase must be uniquely identifiable inside set_mqtt");
const phase = handler.slice(phaseStart);
assert.equal((handler.match(/esp_mqtt_client_register_event\(/g) || []).length, 1);
assert.equal((handler.match(/esp_mqtt_client_start\(/g) || []).length, 1);
assert.ok(handler.indexOf("tcp_port_probe(") < phaseStart,
  "the extracted client phase follows the production TCP probe");
const registration = phase.indexOf("esp_mqtt_client_register_event(");
const start = phase.indexOf("esp_mqtt_client_start(");
const wait = phase.indexOf("xSemaphoreTake(");
const stop = phase.indexOf("esp_mqtt_client_stop(");
const save = phase.indexOf("config_save(c)");
assert(registration >= 0 && start > registration && wait > start && stop > wait && save > stop,
  "registration, transport start, wait, callback join and persistence must retain their boundaries");
const registrationError = String.raw`"{\"ok\":false,\"error\":\"MQTT event registration failed\"}"`;
assert.equal(phase.split(registrationError).length - 1, 1,
  "the registration failure must retain its explicit JSON error literal");
const registrationShortCircuit = /registration_rc\s*!=\s*ESP_OK\s*\|\|\s*(?=esp_mqtt_client_start\()/g;
assert.equal([...phase.matchAll(registrationShortCircuit)].length, 1,
  "the registration result must short-circuit transport start");
const sourceHash = createHash("sha256").update(source).digest("hex");
const extractionHash = createHash("sha256").update(`${context}\n${callback}\n${phase}`).digest("hex");

const adapters = String.raw`
#include <cstdint>
#include <cstdio>
#include <stdexcept>
#include <string>
#include <vector>
using esp_err_t = int;
constexpr int ESP_OK = 0, ESP_FAIL = -1, pdTRUE = 1;
constexpr int pdMS_TO_TICKS(int ms) { return ms; }
using esp_event_base_t = const char*;
enum esp_mqtt_event_id_t { MQTT_EVENT_ANY = -1, MQTT_EVENT_CONNECTED,
                          MQTT_EVENT_DISCONNECTED, MQTT_EVENT_ERROR };
constexpr int MQTT_ERROR_TYPE_TCP_TRANSPORT = 1, MQTT_CONNECTION_ACCEPTED = 0,
              MQTT_CONNECTION_REFUSE_BAD_USERNAME = 4, MQTT_CONNECTION_REFUSE_NOT_AUTHORIZED = 5;
struct Error { int error_type = 0, connect_return_code = 0; };
struct Event { Error* error_handle = nullptr; };
using esp_mqtt_event_handle_t = Event*;
struct Sem { bool signaled = false; };
using SemaphoreHandle_t = Sem*;
using Callback = void (*)(void*, esp_event_base_t, int32_t, void*);
struct Client { Callback callback = nullptr; void* context = nullptr; };
using esp_mqtt_client_handle_t = Client*;
void esp_crt_bundle_attach() {}
struct esp_mqtt_client_config_t {
    struct { struct { const char* uri = nullptr; } address;
             struct { void (*crt_bundle_attach)() = nullptr; } verification; } broker;
    struct { const char* client_id = nullptr; const char* username = nullptr;
             struct { const char* password = nullptr; } authentication; } credentials;
    struct { int keepalive = 0; } session;
};
struct httpd_req_t { std::string status = "200 OK", body; };
struct Config {
    std::string mqtt_uri, mqtt_user, mqtt_pass, mqtt_base;
    uint32_t ref_temp_generation = 0;
};
// This focused broker preflight has no configured room source. The complete HTTP runtime fixture
// separately executes its real identity, generation and post-save history cutover.
namespace logic { uint32_t history_room_identity(const Config&) { return 0; } }
uint32_t esp_random() { throw std::runtime_error("unexpected room-source generation draw"); }
uint32_t diagnostics_next_generation(uint32_t, uint32_t) {
    throw std::runtime_error("unexpected room-source generation change");
}
void history_room_reset(uint32_t identity) {
    if (identity != 0) throw std::runtime_error("unexpected configured room history");
}
enum class Mode { Connected, InitRejected, RegistrationRejected, StartRejected,
                  Timeout, AuthRejected, TcpRejected, Disconnected, SemaphoreRejected };
struct Recording {
    Mode mode = Mode::Connected;
    bool tls = false;
    size_t heap = 64 * 1024;
    int creates = 0, deletes = 0, inits = 0, destroys = 0, registrations = 0,
        starts = 0, stops = 0, takes = 0, gives = 0, saves = 0, reboots = 0;
    Sem sem;
    Client client;
    Config saved;
    std::vector<std::string> order;
} r;
void check(bool value, const char* message) { if (!value) throw std::runtime_error(message); }
SemaphoreHandle_t xSemaphoreCreateBinary() {
    ++r.creates; r.order.push_back("create");
    return r.mode == Mode::SemaphoreRejected ? nullptr : &r.sem;
}
void vSemaphoreDelete(SemaphoreHandle_t sem) {
    check(sem == &r.sem, "delete must identify the request semaphore");
    ++r.deletes; r.order.push_back("delete");
}
void xSemaphoreGive(SemaphoreHandle_t sem) {
    check(sem == &r.sem, "callback must signal the request semaphore");
    ++r.gives; sem->signaled = true;
}
size_t heap_largest_internal_block() { return r.heap; }
void diag_printf(const char*) {}
esp_err_t httpd_resp_set_status(httpd_req_t* req, const char* status) {
    req->status = status; return ESP_OK;
}
esp_err_t http_send_json(httpd_req_t* req, const char* body) { req->body = body; return ESP_OK; }
esp_err_t send_err(httpd_req_t* req, const char* status, const char* message) {
    req->status = status;
    req->body = std::string("{\"ok\":false,\"error\":\"") + message + "\"}";
    return ESP_OK;
}
Config config() { return {}; }
bool config_save(const Config& c) { ++r.saves; r.saved = c; r.order.push_back("save"); return true; }
void reboot_soon() { ++r.reboots; r.order.push_back("reboot"); }
esp_mqtt_client_handle_t esp_mqtt_client_init(const esp_mqtt_client_config_t* cfg) {
    ++r.inits; r.order.push_back("init");
    check(std::string(cfg->broker.address.uri) == (r.tls ? "mqtts://probe.example" : "mqtt://probe.example"),
          "the client must receive the staged URI");
    check(std::string(cfg->credentials.client_id) == "daikin_val", "the probe must keep its distinct id");
    check(cfg->session.keepalive == 15, "the probe must keep its bounded keepalive");
    check((cfg->broker.verification.crt_bundle_attach != nullptr) == r.tls,
          "only TLS probes must attach the certificate bundle");
    check((cfg->credentials.username != nullptr) == r.tls &&
          (cfg->credentials.authentication.password != nullptr) == r.tls,
          "the TLS probe must receive the staged test credentials");
    if (r.tls) {
        check(std::string(cfg->credentials.username) == "test-user" &&
              std::string(cfg->credentials.authentication.password) == "test-pass",
              "staged credentials must remain valid during initialization");
    }
    return r.mode == Mode::InitRejected ? nullptr : &r.client;
}
esp_err_t esp_mqtt_client_register_event(esp_mqtt_client_handle_t client, esp_mqtt_event_id_t id,
                                       Callback callback, void* context) {
    check(client == &r.client && id == MQTT_EVENT_ANY, "the probe must register all client events");
    ++r.registrations; r.order.push_back("register");
    if (r.mode == Mode::RegistrationRejected) return ESP_FAIL;
    client->callback = callback; client->context = context; return ESP_OK;
}
esp_err_t esp_mqtt_client_start(esp_mqtt_client_handle_t client) {
    check(client == &r.client, "start must identify the temporary client");
    ++r.starts; r.order.push_back("start");
    return r.mode == Mode::StartRejected ? ESP_FAIL : ESP_OK;
}
int xSemaphoreTake(SemaphoreHandle_t sem, int timeout) {
    check(sem == &r.sem && timeout == 5000, "the request must retain its five-second bounded wait");
    ++r.takes; r.order.push_back("wait");
    if (!r.client.callback || r.mode == Mode::Timeout) return 0;
    const auto emit = [](int id, void* event = nullptr) {
        r.client.callback(r.client.context, "MQTT", id, event);
    };
    if (r.mode == Mode::AuthRejected || r.mode == Mode::TcpRejected) {
        Error error;
        error.error_type = r.mode == Mode::TcpRejected ? MQTT_ERROR_TYPE_TCP_TRANSPORT : 0;
        error.connect_return_code = MQTT_CONNECTION_REFUSE_BAD_USERNAME;
        Event event{&error};
        emit(MQTT_EVENT_ERROR, &event);
        emit(MQTT_EVENT_DISCONNECTED); // the actual callback's harmless binary double-give
    } else if (r.mode == Mode::Disconnected) emit(MQTT_EVENT_DISCONNECTED);
    else emit(MQTT_EVENT_CONNECTED);
    return sem->signaled ? pdTRUE : 0;
}
esp_err_t esp_mqtt_client_stop(esp_mqtt_client_handle_t client) {
    check(client == &r.client, "stop must identify the temporary client");
    ++r.stops; r.order.push_back("stop"); client->callback = nullptr; return ESP_OK;
}
esp_err_t esp_mqtt_client_destroy(esp_mqtt_client_handle_t client) {
    check(client == &r.client, "destroy must identify the temporary client");
    ++r.destroys; r.order.push_back("destroy"); client->callback = nullptr; return ESP_OK;
}
`;

// The prefix supplies only already-validated inputs. The suffix is verbatim production, including
// the broker block's closing brace, config_save, response and reboot; there is no modeled successor.
const prefix = String.raw`
static esp_err_t exercise(httpd_req_t* req) {
    Config c = config();
    const bool is_tls = r.tls;
    const std::string broker = is_tls ? "mqtts://probe.example" : "mqtt://probe.example";
    const std::string test_uri = broker;
    const std::string user = is_tls ? "test-user" : "";
    const std::string pass = is_tls ? "test-pass" : "";
    const std::string base = "test-base";
    if (!broker.empty()) {
`;

const cases = String.raw`
struct Case { const char* name; Mode mode; bool tls; size_t heap; const char* error; };
const Case cases[] = {
    {"connected", Mode::Connected, false, 64 * 1024, nullptr},
    {"tls_connected", Mode::Connected, true, 64 * 1024, nullptr},
    {"init_rejected", Mode::InitRejected, false, 64 * 1024, "MQTT init failed"},
    {"registration_rejected", Mode::RegistrationRejected, false, 64 * 1024, "MQTT event registration failed"},
    {"start_rejected", Mode::StartRejected, false, 64 * 1024, "MQTT client start failed"},
    {"timeout", Mode::Timeout, false, 64 * 1024, "MQTT connection timeout"},
    {"auth_rejected", Mode::AuthRejected, true, 64 * 1024, "Invalid username or password"},
    {"tcp_rejected", Mode::TcpRejected, true, 64 * 1024, "TLS / TCP connection error"},
    {"disconnected", Mode::Disconnected, false, 64 * 1024, "MQTT connection refused"},
    {"semaphore_rejected", Mode::SemaphoreRejected, false, 64 * 1024, "Device busy; retry MQTT verification"},
    {"plain_heap_low", Mode::Connected, false, 12 * 1024 - 1, "Device busy; retry MQTT verification"},
    {"tls_heap_low", Mode::Connected, true, 48 * 1024 - 1, "Device busy; retry MQTT verification"},
    {"plain_heap_floor", Mode::Connected, false, 12 * 1024, nullptr},
    {"tls_heap_floor", Mode::Connected, true, 48 * 1024, nullptr},
};
void run(const Case& c) {
    r = {}; r.mode = c.mode; r.tls = c.tls; r.heap = c.heap;
    httpd_req_t req;
    check(exercise(&req) == ESP_OK, "the HTTP helper must complete its response");
    if (c.mode == Mode::RegistrationRejected) {
        check(r.starts == 0, "registration failure must not start transport");
        check(r.takes == 0, "registration failure must not wait for an impossible callback");
        check(r.saves == 0 && r.reboots == 0, "registration failure must not reach success continuation");
        check(r.destroys == 1 && r.deletes == 1 && r.stops == 0,
              "registration failure must destroy the client and semaphore exactly once without stop");
    }
    const bool noClient = c.mode == Mode::SemaphoreRejected || r.heap < (r.tls ? 48u : 12u) * 1024u;
    const bool initRejected = c.mode == Mode::InitRejected;
    const bool notStarted = noClient || initRejected || c.mode == Mode::RegistrationRejected ||
                            c.mode == Mode::StartRejected;
    check(r.creates == 1 && r.deletes == (c.mode == Mode::SemaphoreRejected ? 0 : 1),
          "the request semaphore must be balanced");
    check(r.inits == (noClient ? 0 : 1), "insufficient heap must reject before client initialization");
    check(r.registrations == (noClient || initRejected ? 0 : 1),
          "only an initialized client may register callbacks");
    check(r.starts == (noClient || initRejected || c.mode == Mode::RegistrationRejected ? 0 : 1),
          "only a registered client may attempt transport start");
    check(r.takes == (notStarted ? 0 : 1) && r.stops == (notStarted ? 0 : 1),
          "a failed start must neither wait five seconds nor stop an unstarted task");
    check(r.destroys == (noClient || initRejected ? 0 : 1), "the temporary client must be balanced");
    if (c.error) {
        const bool serverFailure = initRejected || c.mode == Mode::RegistrationRejected ||
                                   c.mode == Mode::StartRejected;
        check(req.status == (noClient ? "503 Service Unavailable" : serverFailure ?
              "500 Internal Server Error" : "400 Bad Request"), "failure must retain its HTTP status");
        check(req.body == std::string("{\"ok\":false,\"error\":\"") + c.error + "\"}",
              "failure must retain its explicit JSON reason");
        check(r.saves == 0 && r.reboots == 0, "a rejected preflight must not save or reboot");
    } else {
        check(req.status == "200 OK" && req.body == "{\"ok\":true,\"reboot\":true}",
              "a connected probe must reach the actual success response");
        check(r.gives == 1 && r.saves == 1 && r.reboots == 1,
              "CONNECTED must signal success and save/reboot exactly once");
        check(r.saved.mqtt_uri == (r.tls ? "mqtts://probe.example" : "mqtt://probe.example") &&
              r.saved.mqtt_user == (r.tls ? "test-user" : "") &&
              r.saved.mqtt_pass == (r.tls ? "test-pass" : "") && r.saved.mqtt_base == "test-base",
              "the actual continuation must persist the staged fields");
        check(r.order == std::vector<std::string>{"create", "init", "register", "start", "wait",
              "stop", "destroy", "delete", "save", "reboot"},
              "callback task join and cleanup must precede persistence and reboot");
    }
    check(r.client.callback == nullptr, "no callback may outlive the temporary client phase");
}
int main(int argc, char** argv) {
    int total = 0;
    for (const auto& c : cases) {
        if (argc > 1 && std::string(argv[1]) != c.name) continue;
        try { run(c); ++total; }
        catch (const std::exception& e) { std::fprintf(stderr, "FAIL %s: %s\n", c.name, e.what()); return 1; }
    }
    if (!total) { std::fprintf(stderr, "unknown case\n"); return 2; }
    std::printf("PASS total=%d\n", total);
    return 0;
}
`;

const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "daikin-mqtt-preflight-"));
function execute(command, args) {
  const result = spawnSync(command, args, {
    cwd: root, encoding: "utf8", timeout: 30000, maxBuffer: 1024 * 1024,
  });
  assert.ifError(result.error);
  assert.equal(result.signal, null, `${command} terminated: ${result.stderr}`);
  return result;
}
function compile(name, clientPhase) {
  const input = path.join(temporary, `${name}.cpp`);
  const binary = path.join(temporary, name);
  fs.writeFileSync(input, `${adapters}\n${context}\n${callback}\n${prefix}\n${clientPhase}\n${cases}`);
  const result = execute(process.env.CXX || "c++", [
    "-std=c++17", "-Wall", "-Wextra", "-Werror", "-Wno-unused-parameter", input, "-o", binary,
  ]);
  assert.equal(result.status, 0, `${name}: extracted production must compile\n${result.stdout}${result.stderr}`);
  return binary;
}
try {
  const production = execute(compile("production", phase), []);
  assert.equal(production.status, 0, `production cases\n${production.stdout}${production.stderr}`);
  assert.match(production.stdout, /^PASS total=14\n$/);
  const mutated = phase.replace(registrationShortCircuit, "");
  assert.notEqual(mutated, phase, "negative control must remove only the registration/start short circuit");
  const control = execute(compile("registration-start-short-circuit", mutated), ["registration_rejected"]);
  assert.equal(control.status, 1, `negative control must fail its behavioral oracle\n${control.stdout}${control.stderr}`);
  assert.equal(control.stderr,
    "FAIL registration_rejected: registration failure must not start transport\n",
    "only the named registration assertion counts; a compiler error, crash or other failure cannot pass");
  console.log(`MQTT preflight: 14 production cases, registration-start-short-circuit negative control; source sha256=${sourceHash}; extraction sha256=${extractionHash}`);
} finally {
  fs.rmSync(temporary, { recursive: true, force: true });
}
