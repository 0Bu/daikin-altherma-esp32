#!/usr/bin/env node
// Prove test/test_ota_heap_contract.mjs still detects removal of every load-bearing protection.
// Each mutation runs in an isolated throwaway tree and must turn the real CI contract red.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const contract = path.join(root, "test/test_ota_heap_contract.mjs");
const files = [
  "sdkconfig.defaults",
  "main/ota_update.cpp",
  "main/ota_update.hpp",
  "main/config.cpp",
  "main/http_ota.cpp",
  "main/http_client_diag.cpp",
  "main/mqtt_ha.cpp",
  "main/hp_poll.cpp",
  "main/hp_modbus.cpp",
  "main/syslog.cpp",
  "main/weather_forecast.cpp",
  "main/mcp_server.cpp",
  "main/http_common.cpp",
  "main/http_status.cpp",
  "main/logic/http_values_wait.hpp",
  "main/logic/fixed_text.hpp",
  "main/logic/ota_headroom.hpp",
  "main/logic/ota_quiesce.hpp",
  "main/logic/ota_transport.hpp",
];
const pristine = new Map(files.map((rel) => [rel, fs.readFileSync(path.join(root, rel), "utf8")]));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "daikin-ota-contract-"));

const restore = () => {
  for (const [rel, contents] of pristine) {
    const target = path.join(tmp, rel);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, contents);
  }
};
const run = () => spawnSync(process.execPath, [contract], {
  cwd: root,
  env: { ...process.env, OTA_CONTRACT_ROOT: tmp },
  encoding: "utf8",
});
const replaceOnce = (rel, before, after) => {
  const target = path.join(tmp, rel);
  const old = fs.readFileSync(target, "utf8");
  const changed = old.replace(before, after);
  assert.notEqual(changed, old, `selftest mutation no longer reaches ${rel}: ${String(before)}`);
  fs.writeFileSync(target, changed);
};

try {
  restore();
  const baseline = run();
  if (baseline.status !== 0) {
    process.stderr.write(baseline.stdout + baseline.stderr);
    throw new Error("OTA contract is already red on the unmodified tree");
  }

  const cases = [
    ["signed-on-update is disabled", () =>
      replaceOnce("sdkconfig.defaults", "CONFIG_SECURE_SIGNED_ON_UPDATE_NO_SECURE_BOOT=y",
        "CONFIG_SECURE_SIGNED_ON_UPDATE_NO_SECURE_BOOT=n")],
    ["dynamic TLS buffers are disabled", () =>
      replaceOnce("sdkconfig.defaults", "CONFIG_MBEDTLS_DYNAMIC_BUFFER=y",
        "CONFIG_MBEDTLS_DYNAMIC_BUFFER=n")],
    ["the firmware TLS aggregate floor is weakened to the verifier budget", () =>
      replaceOnce("main/logic/ota_headroom.hpp",
        "OTA_TRANSFER_HEADROOM = {56 * 1024, 24 * 1024, 4}",
        "OTA_TRANSFER_HEADROOM = {24 * 1024, 24 * 1024, 4}")],
    ["the firmware TLS stable-sample requirement is removed", () =>
      replaceOnce("main/logic/ota_headroom.hpp",
        "OTA_TRANSFER_HEADROOM = {56 * 1024, 24 * 1024, 4}",
        "OTA_TRANSFER_HEADROOM = {56 * 1024, 24 * 1024, 1}")],
    ["poll and MQTT resume before the bounded OTA path can finish", () =>
      replaceOnce("main/logic/ota_quiesce.hpp", "OTA_QUIESCE_MAX_CYCLES = 600",
        "OTA_QUIESCE_MAX_CYCLES = 300")],
    ["the contiguous-block half of the headroom predicate is inverted", () =>
      replaceOnce("main/logic/ota_headroom.hpp",
        "largest_free_block >= requirement.min_largest_block_bytes",
        "largest_free_block <= requirement.min_largest_block_bytes")],
    ["an HTTP redirect is admitted as if it were HTTPS", () =>
      replaceOnce("main/logic/ota_transport.hpp",
        "if (ota_url_is_absolute_https(value)) return true;",
        "if (ota_url_is_absolute_https(value) || ota_ascii_prefix_ieq(value, \"http://\")) return true;")],
    ["one initial OTA URL skips the absolute-HTTPS gate", () =>
      replaceOnce("main/ota_update.cpp", "if (!ota_url_is_absolute_https(url))",
        "if (!ota_url_is_https_or_relative(url))")],
    ["one OTA client no longer forces the SSL transport", () =>
      replaceOnce("main/ota_update.cpp", "transport_type    = HTTP_TRANSPORT_OVER_SSL",
        "transport_type    = HTTP_TRANSPORT_UNKNOWN")],
    ["the firmware client silently re-enables automatic redirects", () =>
      replaceOnce("main/ota_update.cpp", "http.disable_auto_redirect = true;",
        "http.disable_auto_redirect = false;")],
    ["redirect Location validation is bypassed", () =>
      replaceOnce("main/ota_update.cpp",
        "ota_redirect_location_observe(response->redirect, event->header_value);",
        "response->redirect.location_count = 1; response->redirect.location_secure = true;")],
    ["Content-Range validation is bypassed", () =>
      replaceOnce("main/ota_update.cpp",
        "ota_content_range_observe(response->content_range, event->header_value);",
        "response->content_range.valid = true;")],
    ["the resume budget loses the second bounded reconnect", () =>
      replaceOnce("main/logic/ota_transport.hpp", "OTA_TRANSFER_MAX_RESUMES = 2",
        "OTA_TRANSFER_MAX_RESUMES = 1")],
    ["the resume budget permits a third reconnect", () =>
      replaceOnce("main/logic/ota_transport.hpp", "OTA_TRANSFER_MAX_RESUMES = 2",
        "OTA_TRANSFER_MAX_RESUMES = 3")],
    ["a resumed stream may fail again without making progress", () =>
      replaceOnce("main/logic/ota_transport.hpp", "stream_started_at < written",
        "stream_started_at <= written")],
    ["the accepted resumed stream forgets its progress origin", () =>
      replaceOnce("main/ota_update.cpp", "stream_started_at = resume_at;",
        "stream_started_at = 0;")],
    ["the consumed resume attempt is never recorded", () =>
      replaceOnce("main/ota_update.cpp", "++resumes;", "resumes += 0;")],
    ["the HTTP header callback may unwind through C frames", () =>
      replaceOnce("main/ota_update.cpp",
        "esp_err_t firmware_http_event(esp_http_client_event_t* event) noexcept",
        "esp_err_t firmware_http_event(esp_http_client_event_t* event)")],
    ["duplicate Content-Range headers are accepted", () =>
      replaceOnce("main/logic/ota_transport.hpp", "state.header_count == 1 && state.valid",
        "state.header_count >= 1 && state.valid")],
    ["Content-Range decimal overflow is ignored", () =>
      replaceOnce("main/logic/ota_transport.hpp",
        "parsed > (std::numeric_limits<uint64_t>::max() - digit) / 10", "false")],
    ["duplicate Location lets an insecure first header hide behind a secure last header", () => {
      replaceOnce("main/logic/ota_transport.hpp", "else\n        state.location_secure = false;",
        "else\n        state.location_secure = ota_url_is_https_or_relative(value);");
      replaceOnce("main/logic/ota_transport.hpp", "state.location_count == 1 && state.location_secure",
        "state.location_count >= 1 && state.location_secure");
    }],
    ["duplicate Location lets a secure first header hide an insecure last header", () => {
      replaceOnce("main/logic/ota_transport.hpp", "else\n        state.location_secure = false;",
        "else\n        state.location_secure = state.location_secure;");
      replaceOnce("main/logic/ota_transport.hpp", "state.location_count == 1 && state.location_secure",
        "state.location_count >= 1 && state.location_secure");
    }],
    ["the redirect socket is reopened without being closed", () =>
      replaceOnce("main/ota_update.cpp",
        /(e = esp_http_client_set_redirection\(client\);[\s\S]{0,600}?)esp_http_client_close\(client\);/,
        "$1esp_http_client_redirect_socket_left_open(client);")],
    ["the redirect response is reused without cleanup", () =>
      replaceOnce("main/ota_update.cpp", "esp_http_client_clear_response_buffer(client);",
        "esp_http_client_response_buffer_left_live(client);")],
    ["a mid-stream failure is not diagnosed before cleanup", () =>
      replaceOnce("main/ota_update.cpp", "http_client_log_read_failure(\n            \"ota\", client, n, written, total,",
        "http_client_read_failure_hidden(\n            \"ota\", client, n, written, total,")],
    ["mid-stream diagnostics lose the socket errno", () =>
      replaceOnce("main/http_client_diag.cpp",
        "failure.socket_errno = esp_http_client_get_errno(client);",
        "failure.socket_errno = 0;")],
    ["range resume skips transport-buffer cleanup", () =>
      replaceOnce("main/ota_update.cpp",
        "heap_caps_free(buffer);\n        buffer = nullptr;\n        close_http_client(client);",
        "buffer = nullptr;\n        close_http_client(client);")],
    ["range resume leaves the failed TLS client alive", () =>
      replaceOnce("main/ota_update.cpp",
        "buffer = nullptr;\n        close_http_client(client);\n        ota_heap_sample();",
        "buffer = nullptr;\n        client = nullptr;\n        ota_heap_sample();")],
    ["range resume skips the stable TLS headroom gate", () =>
      replaceOnce("main/ota_update.cpp",
        "wait_for_ota_headroom_until(\"transfer resume\", OTA_TRANSFER_HEADROOM,",
        "wait_for_ota_headroom_until_bypassed(\"transfer resume\", OTA_TRANSFER_HEADROOM,")],
    ["range resume resets the absolute transfer deadline", () =>
      replaceOnce("main/ota_update.cpp",
        "kTransferHeadroomMaxAttempts, transfer_started,\n                                         kFirmwareDeadline, resume_heap",
        "kTransferHeadroomMaxAttempts, xTaskGetTickCount(),\n                                         kFirmwareDeadline, resume_heap")],
    ["range resume allocates a client after its deadline expired", () =>
      replaceOnce("main/ota_update.cpp",
        /(wait_for_ota_headroom_until\("transfer resume"[\s\S]{0,900}?)if \(http_deadline_reached\(transfer_started, kFirmwareDeadline\)\)/,
        "$1if (false)")],
    ["firmware opens ignore the remaining operation deadline", () =>
      replaceOnce("main/ota_update.cpp",
        "!set_http_timeout_to_deadline(client, operation_started, operation_deadline)",
        "false")],
    ["firmware header fetches reuse the pre-handshake timeout", () =>
      replaceOnce("main/ota_update.cpp",
        /(esp_http_client_open\(client, 0\);[\s\S]{0,180}?)!set_http_timeout_to_deadline\(client, operation_started, operation_deadline\)/,
        "$1false")],
    ["firmware header fetches can cross the operation deadline", () =>
      replaceOnce("main/ota_update.cpp",
        /(esp_http_client_fetch_headers\(client\)[\s\S]{0,180}?)http_deadline_reached\(operation_started, operation_deadline\)/,
        "$1false")],
    ["a failed TLS open hides an exhausted operation deadline", () =>
      replaceOnce("main/ota_update.cpp",
        /(if \(e != ESP_OK\) \{\n)            return http_deadline_reached\(operation_started, operation_deadline\)\n                 \? ESP_ERR_TIMEOUT : e;/,
        "$1            return e;")],
    ["a failed header fetch hides an exhausted operation deadline", () =>
      replaceOnce("main/ota_update.cpp",
        /(if \(header_result < 0\) \{\n)            return http_deadline_reached\(operation_started, operation_deadline\)\n                 \? ESP_ERR_TIMEOUT : ESP_FAIL;/,
        "$1            return ESP_FAIL;")],
    ["initial firmware-open timeout is mislabeled as reachability", () =>
      replaceOnce("main/ota_update.cpp",
        'e == ESP_ERR_TIMEOUT ? "Update download timed out"',
        'false ? "Update download timed out"')],
    ["range-resume open timeout is mislabeled as a read failure", () =>
      replaceOnce("main/ota_update.cpp",
        /(diag_printf\("ota: range resume open failed[\s\S]{0,260}?)transfer_failure = e == ESP_ERR_TIMEOUT \? OtaTransferFailure::Timeout\n                                                    : OtaTransferFailure::Read;/,
        "$1transfer_failure = OtaTransferFailure::Read;")],
    ["range resume asks for the image from byte zero", () =>
      replaceOnce("main/ota_update.cpp", "\"bytes=%llu-\"", "\"bytes=0-\"")],
    ["range resume accepts a full 200 response", () =>
      replaceOnce("main/ota_update.cpp",
        "open_firmware_stream(client, response_state, 206, transfer_started,",
        "open_firmware_stream(client, response_state, 200, transfer_started,")],
    ["range resume ignores the exact Content-Range", () =>
      replaceOnce("main/ota_update.cpp", "const bool range_ok = ota_content_range_matches(",
        "const bool range_ok = ota_content_range_matches_bypassed(")],
    ["range resume accepts a chunked suffix", () =>
      replaceOnce("main/ota_update.cpp", "esp_http_client_is_chunked_response(client)", "false")],
    ["range resume ignores the remaining Content-Length", () =>
      replaceOnce("main/ota_update.cpp",
        "static_cast<uint64_t>(response_length) != remaining", "false")],
    ["the firmware-transfer headroom gate is bypassed", () =>
      replaceOnce("main/ota_update.cpp",
        /if\s*\(!wait_for_ota_headroom\(\s*"transfer"([\s\S]{0,180}?)\)\)\s*\{/,
        "if (ota_transfer_headroom_gate_bypassed($1)) {")],
    ["the manifest TLS headroom gate is bypassed", () =>
      replaceOnce("main/ota_update.cpp",
        /if\s*\(!wait_for_ota_headroom\(\s*"manifest"([\s\S]{0,180}?)\)\)\s*\{/,
        "if (ota_manifest_headroom_gate_bypassed($1)) {")],
    ["a trickling manifest can hold the network heap forever", () =>
      replaceOnce("main/ota_update.cpp",
        "!set_http_timeout_to_deadline(c, manifest_started, kManifestDeadline)",
        "false")],
    ["a trickling image header can hold the network heap forever", () =>
      replaceOnce("main/ota_update.cpp",
        "!set_http_timeout_to_deadline(client, transfer_started, kFirmwareDeadline)",
        "false")],
    ["a trickling firmware body can hold the network heap forever", () =>
      replaceOnce("main/ota_update.cpp",
        /(while \(transfer_ok\) \{[\s\S]{0,180}?)!set_http_timeout_to_deadline\(client, transfer_started, kFirmwareDeadline\)/,
        "$1false")],
    ["a trickling weather response can hold the network heap forever", () =>
      replaceOnce("main/weather_forecast.cpp", "elapsed >= kDownloadDeadline",
        "false")],
    ["manifest deadline expiry after a blocking read is mislabeled", () =>
      replaceOnce("main/ota_update.cpp",
        "http_deadline_reached(manifest_started, kManifestDeadline)", "false")],
    ["image-header deadline expiry after a blocking read is mislabeled", () =>
      replaceOnce("main/ota_update.cpp",
        /(while \(probe_len < kImageProbeSize\)[\s\S]{0,700}?)http_deadline_reached\(transfer_started, kFirmwareDeadline\)/,
        "$1false")],
    ["firmware-body deadline expiry after a blocking read is mislabeled", () =>
      replaceOnce("main/ota_update.cpp",
        /(while \(transfer_ok\)[\s\S]{0,700}?)http_deadline_reached\(transfer_started, kFirmwareDeadline\)/,
        "$1false")],
    ["weather deadline expiry after a blocking read is mislabeled", () =>
      replaceOnce("main/weather_forecast.cpp",
        "xTaskGetTickCount() - download_started >= kDownloadDeadline", "false")],
    ["HTTP cleanup before validation disappears", () =>
      replaceOnce("main/ota_update.cpp",
        /(\/\/ CRITICAL ORDERING:[\s\S]{0,900}?buffer = nullptr;\n    )close_http_client\(client\);/,
        "$1close_http_client_after_validation(client);")],
    ["the signed-image verifier is bypassed", () =>
      replaceOnce("main/ota_update.cpp", "esp_ota_end(ota_handle)",
        "esp_ota_end_bypassed(ota_handle)")],
    ["boot selection revalidation loses its heap gate", () =>
      replaceOnce("main/ota_update.cpp",
        /if\s*\(!wait_for_ota_headroom\(\s*"boot selection"([\s\S]{0,180}?)\)\)\s*\{/,
        "if (ota_boot_selection_headroom_gate_bypassed($1)) {")],
    ["validation is again mislabeled as a bad signature", () =>
      replaceOnce("main/ota_update.cpp", "Update rejected: image validation failed",
        "Update rejected: bad signature")],
    ["the memory refusal no longer tells the operator how to retry", () =>
      replaceOnce("main/ota_update.cpp", " — retry after reboot", "")],
    ["manifest TLS allocation failure is mislabeled as server reachability", () =>
      replaceOnce("main/ota_update.cpp",
        /(err\s*=\s*retryable_allocator_failure\s*\n\s*)\? "Not enough memory for update TLS — retry after reboot"/,
        "$1? \"Can't reach the update server\"")],
    ["firmware TLS allocation failure is mislabeled as server reachability", () =>
      replaceOnce("main/ota_update.cpp",
        /(set_state\("error", allocator_failure\s*\n\s*)\? "Not enough memory for update TLS — retry after reboot"/,
        "$1? \"Can't reach the update server\"")],
    ["rollback probation is mislabeled as an unknown download failure", () =>
      replaceOnce("main/ota_update.cpp", "e == ESP_ERR_OTA_ROLLBACK_INVALID_STATE",
        "e == ESP_ERR_INVALID_STATE")],
    ["an image-size overrun is mislabeled as a read failure", () =>
      replaceOnce("main/ota_update.cpp",
        "transfer_failure = OtaTransferFailure::Size;",
        "transfer_failure = OtaTransferFailure::Read;")],
    ["the held X10A task no longer acknowledges quiescence", () =>
      replaceOnce("main/hp_poll.cpp",
        "s_network_quiesced.store(true, std::memory_order_release);",
        "s_network_quiesced.store(false, std::memory_order_release);")],
    ["the held MQTT task no longer acknowledges quiescence", () =>
      replaceOnce("main/mqtt_ha.cpp",
        "s_publish_network_quiesced.store(true, std::memory_order_release);\n            vTaskDelay",
        "s_publish_network_quiesced.store(false, std::memory_order_release);\n            vTaskDelay")],
    ["HomeHub keeps allocating during OTA", () =>
      replaceOnce("main/hp_modbus.cpp", "if (ota_download_active() || weather_fetch_active()) {",
        "if (false) {")],
    ["Syslog keeps allocating during OTA", () =>
      replaceOnce("main/syslog.cpp", "if (ota_download_active() || weather_fetch_active()) {",
        "if (false) {")],
    ["HomeHub no longer acknowledges an in-flight allocation cycle", () =>
      replaceOnce("main/hp_modbus.cpp",
        "s_network_quiesced.store(false, std::memory_order_release);",
        "s_network_quiesced.store(true, std::memory_order_release);")],
    ["Syslog no longer acknowledges an in-flight allocation cycle", () =>
      replaceOnce("main/syslog.cpp",
        "s_network_quiesced.store(false, std::memory_order_release);",
        "s_network_quiesced.store(true, std::memory_order_release);")],
    ["Weather starts TLS without the HomeHub acknowledgement", () =>
      replaceOnce("main/weather_forecast.cpp", "!mb_network_quiesced() ||",
        "false ||")],
    ["Weather starts TLS without the Syslog acknowledgement", () =>
      replaceOnce("main/weather_forecast.cpp", "!syslog_network_quiesced()) &&",
        "false) &&")],
    ["the MQTT acknowledgement ignores an asynchronous TLS reconnect", () =>
      replaceOnce("main/mqtt_ha.cpp",
        "!s_transport_connecting.load(std::memory_order_acquire);",
        "true;")],
    ["MQTT BEFORE_CONNECT no longer marks transport activity", () =>
      replaceOnce("main/mqtt_ha.cpp",
        /(static void mqtt_transport_before_connect\(\) \{[\s\S]{0,180}?)s_transport_connecting\.store\(true, std::memory_order_release\);/,
        "$1s_transport_connecting.store(false, std::memory_order_release);")],
    ["MQTT startup allocates beside an OTA that already owns TLS", () =>
      replaceOnce("main/mqtt_ha.cpp",
        "if (!competing_tls_active()) return;",
        "if (true) return;")],
    ["MQTT promotion leaves a stale transport claim after client stop", () =>
      replaceOnce("main/mqtt_ha.cpp",
        "s_transport_connecting.store(false, std::memory_order_release);\n    s_client_running.store(false, std::memory_order_release);\n\n    s_connected = false;",
        "s_transport_connecting.store(true, std::memory_order_release);\n    s_client_running.store(false, std::memory_order_release);\n\n    s_connected = false;")],
    ["OTA starts without waiting for the X10A acknowledgement", () =>
      replaceOnce("main/ota_update.cpp", "if (!wait_for_poll_quiesce())",
        "if (false)")],
    ["OTA starts without waiting for the MQTT acknowledgement", () =>
      replaceOnce("main/ota_update.cpp", "else if (!wait_for_mqtt_quiesce())",
        "else if (false)")],
    ["OTA starts without waiting for the stopped MQTT transport", () =>
      replaceOnce("main/ota_update.cpp", "else if (!wait_for_mqtt_transport_quiesce())",
        "else if (false)")],
    ["OTA no longer requests the MQTT transport pause", () =>
      replaceOnce("main/ota_update.cpp", "mqtt_transport_pause_for_network_heap();",
        "mqtt_transport_pause_bypassed();")],
    ["MQTT keepalive transport remains live beside OTA TLS", () =>
      replaceOnce("main/mqtt_ha.cpp", "esp_mqtt_client_stop(s_client);",
        "esp_mqtt_client_stop_bypassed(s_client);")],
    ["MQTT transport pause is never acknowledged", () =>
      replaceOnce("main/mqtt_ha.cpp",
        "s_transport_paused.store(true, std::memory_order_release);",
        "s_transport_paused.store(false, std::memory_order_release);")],
    ["MQTT transport is never resumed after network TLS", () =>
      replaceOnce("main/mqtt_ha.cpp", "const esp_err_t start_rc = start_client_transport();",
        "const esp_err_t start_rc = ESP_FAIL;")],
    ["MQTTS resumes without stable contiguous heap", () =>
      replaceOnce("main/mqtt_ha.cpp", "free_internal < kMqttTlsResumeMinFree",
        "free_internal < 0")],
    ["failed MQTT transport resume churns every second", () =>
      replaceOnce("main/mqtt_ha.cpp",
        "transport_resume_wait_s = transport_resume_backoff_s;",
        "transport_resume_wait_s = 0;")],
    ["Weather no longer requests the MQTT transport pause", () =>
      replaceOnce("main/weather_forecast.cpp", "mqtt_transport_pause_for_network_heap();",
        "mqtt_transport_pause_bypassed();")],
    ["OTA starts without waiting for the HomeHub acknowledgement", () =>
      replaceOnce("main/ota_update.cpp", "else if (!wait_for_modbus_quiesce())",
        "else if (false)")],
    ["OTA starts without waiting for the Syslog acknowledgement", () =>
      replaceOnce("main/ota_update.cpp", "else if (!wait_for_syslog_quiesce())",
        "else if (false)")],
    ["status snapshots keep allocating during OTA", () =>
      replaceOnce("main/http_status.cpp",
        "if (ota_download_active()) return network_tls_busy(req);",
        "if (false) return network_tls_busy(req);")],
    ["the active model catalog keeps allocating during OTA", () =>
      replaceOnce("main/http_status.cpp",
        /(static esp_err_t h_active_model_values\(httpd_req_t\* req\) \{[\s\S]{0,260}?)if \(ota_download_active\(\)\) return network_tls_busy\(req\);/,
        "$1if (false) return network_tls_busy(req);")],
    ["history keeps allocating during OTA", () =>
      replaceOnce("main/http_status.cpp",
        /(static esp_err_t h_history\(httpd_req_t\* req\) \{[\s\S]{0,260}?)if \(ota_download_active\(\)\) return network_tls_busy\(req\);/,
        "$1if (false) return network_tls_busy(req);")],
    ["redacted diagnostics keep allocating during OTA", () =>
      replaceOnce("main/http_status.cpp",
        "if (redact && ota_download_active()) return network_tls_busy(req);",
        "if (redact && false) return network_tls_busy(req);")],
    ["Wi-Fi scans remain reachable during OTA", () =>
      replaceOnce("main/http_status.cpp",
        /(static esp_err_t h_scan\(httpd_req_t\* req\) \{[\s\S]{0,260}?)if \(ota_download_active\(\)\) return network_tls_busy\(req\);/,
        "$1if (false) return network_tls_busy(req);")],
    ["MCP get_status keeps allocating during OTA", () =>
      replaceOnce("main/mcp_server.cpp", "if (ota_download_active()) {",
        "if (false) {")],
    ["mutating POSTs remain reachable during OTA", () =>
      replaceOnce("main/http_common.cpp",
        "req->method == HTTP_POST && ota_busy()",
        "req->method == HTTP_POST && false")],
    ["values snapshots keep allocating during OTA", () =>
      replaceOnce("main/http_status.cpp",
        /(esp_err_t http_send_values_json\([\s\S]{0,420}?)if \(ota_download_active\(\)\) return network_tls_busy\(req\);/,
        "$1if (false) return network_tls_busy(req);")],
    ["values snapshots no longer wait behind a weather TLS owner", () =>
      replaceOnce("main/http_status.cpp", "false, weather_fetch_active()",
        "false, false")],
    ["the values TLS wait exceeds the live request timeout", () =>
      replaceOnce("main/http_status.cpp", "pdMS_TO_TICKS(4000)",
        "pdMS_TO_TICKS(6000)")],
    ["the values snapshot allocates before its TLS-owner wait", () =>
      replaceOnce("main/http_status.cpp", "if (!wait_for_values_tls_owner())",
        "if (!wait_for_values_tls_owner_bypassed())")],
    ["the X10A poll no longer enters the bounded OTA quiesce", () =>
      replaceOnce("main/hp_poll.cpp", "ota_quiesce_step(network_quiesce, network_active)",
        "ota_quiesce_bypassed(network_quiesce, network_active)")],
    ["a busy OTA check is acknowledged as HTTP success", () =>
      replaceOnce("main/http_ota.cpp", 'httpd_resp_set_status(req, "503 Service Unavailable");',
        'httpd_resp_set_status(req, "200 OK");')],
    ["accepted OTA operations lose their generation response", () =>
      replaceOnce("main/http_ota.cpp", '"{\\"ok\\":true,\\"generation\\":%lu}"',
        '"{\\"ok\\":true}"')],
    ["OTA status hides the busy handshake", () =>
      replaceOnce("main/http_ota.cpp", 'j += ",\\"busy\\":"; j += s.busy ? "true" : "false";',
        'j += ",\\"busy\\":false";')],
    ["an update can consume a replaced check generation", () =>
      replaceOnce("main/ota_update.cpp", "s_generation != after_generation",
        "false")],
    ["accepted artifact identity is dropped before task creation", () =>
      replaceOnce("main/ota_update.cpp", "s_task_args = request;",
        "s_task_args = OtaTaskArgs{};")],
    ["task-creation failure still advances the public generation", () =>
      replaceOnce("main/ota_update.cpp", "s_generation = previous_generation;",
        "s_generation = next_generation(previous_generation);")],
    ["the downloaded byte stream is no longer hashed", () =>
      replaceOnce("main/ota_update.cpp", "psa_hash_update(&hash_operation, data, len)",
        "psa_hash_update_bypassed(&hash_operation, data, len)")],
    ["the exact downloaded application SHA is ignored", () =>
      replaceOnce("main/ota_update.cpp", "!ota_sha256_matches(actual_sha256, request.app_sha256)",
        "false")],
    ["the update endpoint no longer requires the checked SHA", () =>
      replaceOnce("main/http_ota.cpp", 'httpd_query_key_value(q, "sha256", app_sha256, sizeof(app_sha256))',
        'httpd_query_key_value(q, "ignored", app_sha256, sizeof(app_sha256))')],
    ["OTA status copies allocate a dynamic SHA string during TLS pressure", () =>
      replaceOnce("main/ota_update.hpp", "std::array<char, 65> available_sha256{};",
        "std::string available_sha256;")],
    ["OTA status copies allocate dynamic message text during TLS pressure", () =>
      replaceOnce("main/ota_update.hpp", "FixedText<128> message;",
        "std::string message;")],
    ["OTA status copies the complete string-owning Config", () =>
      replaceOnce("main/ota_update.cpp", "ota_channel_name(config_ota_channel())",
        "ota_channel_name(config().ota_channel)")],
    ["OTA status response grows a dynamic JSON string during TLS pressure", () =>
      replaceOnce("main/http_ota.cpp", "FixedBuffer<2048> j;",
        "std::string j;")],
    ["OTA status hides the sampled transfer low-water", () =>
      replaceOnce("main/http_ota.cpp", 'j += ",\\"heap_min_free_bytes\\":";',
        'j += ",\\"heap_min_free_bytes_hidden\\":";')],
    ["transfer progress no longer samples heap", () =>
      replaceOnce("main/ota_update.cpp",
        "    ota_heap_sample();\n    Lock lk(s_mtx);\n    s_status.progress = pct;",
        "    Lock lk(s_mtx);\n    s_status.progress = pct;")],
    ["release notes are copied into the hot OTA status snapshot", () =>
      replaceOnce("main/ota_update.hpp", "std::array<char, 65> available_sha256{};",
        "std::array<char, 65> available_sha256{};\n    const char* changelog = nullptr;")],
    ["the changelog endpoint materialises its response instead of streaming", () =>
      replaceOnce("main/http_ota.cpp", "httpd_resp_send_chunk(req, chunk, copied)",
        "httpd_resp_send(req, chunk, copied)")],
    ["the changelog stream no longer consumes its retained heap lease", () =>
      replaceOnce("main/http_ota.cpp", "ota_changelog_release(generation);",
        "ota_changelog_release_bypassed(generation);")],
    ["the changelog document is no longer bound to the checked version", () =>
      replaceOnce("main/ota_update.cpp",
        "manifest_changelog(document.get(), got, expected_version,",
        "manifest_changelog(document.get(), got, \"ignored-version\",")],
    ["the optional changelog opens a second TLS client without a heap gate", () =>
      replaceOnce("main/ota_update.cpp",
        'wait_for_ota_headroom("changelog", OTA_CHANGELOG_HEADROOM,',
        'wait_for_ota_headroom_bypassed("changelog", OTA_CHANGELOG_HEADROOM,')],
    ["the changelog TLS budget drifts below the measured transfer floor", () =>
      replaceOnce("main/logic/ota_headroom.hpp",
        "OTA_CHANGELOG_HEADROOM = OTA_TRANSFER_HEADROOM",
        "OTA_CHANGELOG_HEADROOM = OTA_VALIDATION_HEADROOM")],
    ["a trickling changelog body can hold the network heap forever", () =>
      replaceOnce("main/ota_update.cpp",
        /(while \(got < kChangelogDocumentMax\) \{[\s\S]{0,180}?)!set_http_timeout_to_deadline\(c, changelog_started, kChangelogDeadline,/,
        "$1false && !set_http_timeout_to_deadline(c, changelog_started, kChangelogDeadline,")],
    ["the changelog URL is rebuilt on the heap", () =>
      replaceOnce("main/ota_update.cpp", "char url[256] = {};",
        "std::string url;")],
    ["decoded changelog retention grows back to the full document slot", () =>
      replaceOnce("main/ota_update.cpp", "heap_caps_malloc(decoded_len + 1, MALLOC_CAP_8BIT)",
        "heap_caps_malloc(kChangelogDocumentMax, MALLOC_CAP_8BIT)")],
    ["the changelog TTL allocates its timer control block from heap", () =>
      replaceOnce("main/ota_update.cpp", "xTimerCreateStatic(\"ota_notes\"",
        "xTimerCreate(\"ota_notes\"")],
    ["the changelog timer daemon blocks on the OTA mutex", () =>
      replaceOnce("main/ota_update.cpp", "Lock lk(s_mtx, 0);",
        "Lock lk(s_mtx);")],
  ];

  let caught = 0;
  for (const [name, mutate] of cases) {
    restore();
    mutate();
    const result = run();
    if (result.status === 0) throw new Error(`OTA contract missed mutation: ${name}`);
    caught++;
    console.log(`ota selftest: detected — ${name}`);
  }
  console.log(`ota selftest: all ${caught} seeded regressions caught`);
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
