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
  "main/CMakeLists.txt",
  "main/main.cpp",
  "main/http_deadline.cpp",
  "main/http_deadline.hpp",
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
  "main/logic/http_deadline.hpp",
  "main/logic/health_gate.hpp",
  "main/logic/ota_changelog_range.hpp",
  "main/logic/ota_manifest.hpp",
  "main/logic/payload_complete.hpp",
  "main/logic/fixed_text.hpp",
  "main/logic/ota_hil_feed.hpp",
  "main/logic/ota_headroom.hpp",
  "main/logic/ota_quiesce.hpp",
  "main/logic/ota_transport.hpp",
  "main/stack_watch.hpp",
  "scripts/check-manifest-provenance.py",
  "tools/stack/budgets.json",
  "docs/SECURITY.md",
  "docs/FEATURES.md",
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
    ["an unreadable otadata state is reported as unarmed", () =>
      replaceOnce("main/ota_update.cpp",
        "s_runtime_image_state.store(static_cast<uint8_t>(OtaRuntimeImageState::Unknown),",
        "s_runtime_image_state.store(static_cast<uint8_t>(OtaRuntimeImageState::Unarmed),")],
    ["the pending-verify branch is inverted", () =>
      replaceOnce("main/ota_update.cpp", "if (st != ESP_OTA_IMG_PENDING_VERIFY)",
        "if (st == ESP_OTA_IMG_PENDING_VERIFY)")],
    ["an arbitrary non-pending image is reported as valid", () =>
      replaceOnce("main/ota_update.cpp",
        "st == ESP_OTA_IMG_VALID ? OtaRuntimeImageState::Valid : OtaRuntimeImageState::Unarmed",
        "st == ESP_OTA_IMG_VALID ? OtaRuntimeImageState::Unarmed : OtaRuntimeImageState::Valid")],
    ["a failed rollback commit is reported as valid", () =>
      replaceOnce("main/ota_update.cpp", "if (e == ESP_OK) {", "if (true) {")],
    ["the OTA manifest path may consume the final 1 KiB reserve", () =>
      replaceOnce("tools/stack/budgets.json",
        '"ota_task_manifest_fetch": {\n      "symbols": ["ota_task", "ota_manifest_fetch_wrapper", "ota_manifest_fetch", "ota_manifest_identity", "ota_manifest_skip_value"],\n      "multipliers": {"ota_manifest_skip_value": 9},\n      "base_bytes": 0,\n      "max_bytes": 6144',
        '"ota_task_manifest_fetch": {\n      "symbols": ["ota_task", "ota_manifest_fetch_wrapper", "ota_manifest_fetch", "ota_manifest_identity", "ota_manifest_skip_value"],\n      "multipliers": {"ota_manifest_skip_value": 9},\n      "base_bytes": 0,\n      "max_bytes": 11776')],
    ["the firmware manifest frame shrinks below the publisher contract", () =>
      replaceOnce("main/ota_update.cpp", "constexpr size_t   kManifestMax        = 2048;",
        "constexpr size_t   kManifestMax        = 1024;")],
    ["the publisher stops reading the firmware manifest limit", () =>
      replaceOnce("scripts/check-manifest-provenance.py",
        'OTA_SOURCE = ROOT / "main/ota_update.cpp"',
        'OTA_SOURCE = ROOT / "main/main.cpp"')],
    ["the publisher drops the oldest supported release restore limit", () =>
      replaceOnce("scripts/check-manifest-provenance.py",
        "LEGACY_RESTORE_MANIFEST_MAX_BYTES = 1024",
        "LEGACY_RESTORE_MANIFEST_MAX_BYTES = 2048")],
    ["the publisher admits escaped identities rejected by the restore parser", () =>
      replaceOnce("scripts/check-manifest-provenance.py",
        'if b"\\\\" in manifest_bytes:',
        'if False and b"\\\\" in manifest_bytes:')],
    ["the rollback health gate may consume the final 1 KiB reserve", () =>
      replaceOnce("tools/stack/budgets.json",
        '"ota_health_gate": {\n      "symbols": ["ota_health_task"],\n      "multipliers": {},\n      "base_bytes": 2048,\n      "max_bytes": 3072',
        '"ota_health_gate": {\n      "symbols": ["ota_health_task"],\n      "multipliers": {},\n      "base_bytes": 2048,\n      "max_bytes": 4096')],
    ["the Weather download path may consume the final 1 KiB reserve", () =>
      replaceOnce("tools/stack/budgets.json",
        '"weather_task_download": {\n      "symbols": ["weather_task", "weather_fetch", "weather_download"],\n      "multipliers": {},\n      "base_bytes": 2048,\n      "max_bytes": 11264',
        '"weather_task_download": {\n      "symbols": ["weather_task", "weather_fetch", "weather_download"],\n      "multipliers": {},\n      "base_bytes": 2048,\n      "max_bytes": 11265')],
    ["the Weather parse path may consume the final 1 KiB reserve", () =>
      replaceOnce("tools/stack/budgets.json",
        '"weather_task_parse": {\n      "symbols": ["weather_task", "weather_fetch", "weather_parse"],\n      "multipliers": {},\n      "base_bytes": 2048,\n      "max_bytes": 11264',
        '"weather_task_parse": {\n      "symbols": ["weather_task", "weather_fetch", "weather_parse"],\n      "multipliers": {},\n      "base_bytes": 2048,\n      "max_bytes": 11265')],
    ["the Weather TLS path is no longer sampled before HIL completion", () =>
      replaceOnce("main/weather_forecast.cpp",
        "            stack_watch_sample(StackWatch::Weather);\n            // A location/consent save",
        "            // Weather stack sample bypassed\n            // A location/consent save")],
    ["blank USB otadata is documented as a known unarmed state", () =>
      replaceOnce("docs/SECURITY.md", 'is latched as `unknown`', 'boots `UNDEFINED`')],
    ["dynamic TLS buffers are disabled", () =>
      replaceOnce("sdkconfig.defaults", "CONFIG_MBEDTLS_DYNAMIC_BUFFER=y",
        "CONFIG_MBEDTLS_DYNAMIC_BUFFER=n")],
    ["the size build folds MQTT helpers back into the fixed task frame", () =>
      replaceOnce("main/CMakeLists.txt", "-fno-inline-functions-called-once",
        "-finline-functions-called-once")],
    ["the MQTT fixed-frame build ceiling is weakened above the regressed task", () =>
      replaceOnce("main/CMakeLists.txt", "-Werror=frame-larger-than=2048",
        "-Werror=frame-larger-than=4096")],
    ["the boot no longer pre-allocates the shared HTTP deadline timer", () =>
      replaceOnce("main/main.cpp", "if (!daik::http_deadline_init())",
        "if (!daik::http_deadline_init_bypassed())")],
    ["the socket watchdog no longer binds the public HTTP socket", () =>
      replaceOnce("main/http_deadline.cpp", "esp_http_client_get_socket(client)",
        "esp_http_client_get_socket_bypassed(client)")],
    ["the static watchdog no longer interrupts the blocking socket", () =>
      replaceOnce("main/http_deadline.cpp", "shutdown(socket, SHUT_RDWR)",
        "shutdown_bypassed(socket, SHUT_RDWR)")],
    ["the static watchdog no longer acknowledges completion", () =>
      replaceOnce("main/http_deadline.cpp", "xSemaphoreGive(s_deadline.completion)",
        "xSemaphoreGive_bypassed(s_deadline.completion)")],
    ["the deadline watchdog task becomes dynamically allocated", () =>
      replaceOnce("main/http_deadline.cpp", "xTaskCreateStatic(", "xTaskCreate(")],
    ["the deadline watchdog skips its boot-time lwIP prime", () =>
      replaceOnce("main/http_deadline.cpp", "sys_thread_sem_get()", "nullptr")],
    ["the deadline watchdog accepts a failed lwIP semaphore prime", () =>
      replaceOnce("main/http_deadline.cpp", "thread_sem != nullptr", "true")],
    ["a failed deadline shutdown is acknowledged as success", () =>
      replaceOnce("main/http_deadline.cpp", "shutdown_result != 0 && shutdown_errno != ENOTCONN",
        "false")],
    ["deadline disarm no longer joins an already dispatched callback", () =>
      replaceOnce("main/http_deadline.cpp",
        "xSemaphoreTake(s_deadline.completion, portMAX_DELAY)",
        "xSemaphoreTake(s_deadline.completion, 0)")],
    ["deadline re-arm can consume a stale completion acknowledgement", () =>
      replaceOnce("main/http_deadline.cpp",
        "while (xSemaphoreTake(s_deadline.completion, 0) == pdTRUE) {}",
        "while (false) {}")],
    ["HTTP cleanup can recycle the fd before watchdog disarm", () =>
      replaceOnce("main/ota_update.cpp", "(void)deadline.disarm();",
        "(void)deadline.disarm_bypassed();")],
    ["the timer callback performs socket work itself", () =>
      replaceOnce("main/http_deadline.cpp", "xTaskNotifyGive(s_deadline.watchdog_task);",
        "(void)shutdown(socket, SHUT_RDWR);")],
    ["OTA operation acceptance ignores an unavailable deadline watchdog", () =>
      replaceOnce("main/ota_update.cpp", "if (!http_deadline_ready()) return 0;", "if (false) return 0;")],
    ["OTA worker stack returns to the fragmented runtime heap", () =>
      replaceOnce("main/ota_update.cpp", "xTaskCreateStatic(ota_task", "xTaskCreate(ota_task")],
    ["Weather payload allocation ignores an unavailable deadline watchdog", () =>
      replaceOnce("main/weather_forecast.cpp",
        /(bool download_json\([\s\S]{0,220}?)if \(!http_deadline_ready\(\)\)/,
        "$1if (false)")],
    ["Weather task creation ignores an unavailable deadline watchdog", () =>
      replaceOnce("main/weather_forecast.cpp",
        /(void weather_forecast_start\(\)[\s\S]{0,500}?)if \(!http_deadline_ready\(\)\)/,
        "$1if (false)")],
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
      replaceOnce("main/ota_update.cpp", /transport_type\s*=\s*HTTP_TRANSPORT_OVER_SSL/,
        "transport_type = HTTP_TRANSPORT_UNKNOWN")],
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
        "heap_caps_free(buffer);\n        buffer = nullptr;\n        close_http_client(client, socket_deadline);",
        "buffer = nullptr;\n        close_http_client(client, socket_deadline);")],
    ["range resume leaves the failed TLS client alive", () =>
      replaceOnce("main/ota_update.cpp",
        "buffer = nullptr;\n        close_http_client(client, socket_deadline);\n        ota_heap_sample();",
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
        /(esp_http_client_open\(client, 0\);[\s\S]{0,500}?)!set_http_timeout_to_deadline\(client, operation_started, operation_deadline\)/,
        "$1false")],
    ["firmware header fetches can cross the operation deadline", () =>
      replaceOnce("main/ota_update.cpp",
        /(esp_http_client_fetch_headers\(client\)[\s\S]{0,220}?)socket_deadline\.expired\(\)/,
        "$1false")],
    ["a failed TLS open hides an exhausted operation deadline", () =>
      replaceOnce("main/ota_update.cpp",
        /if \(e != ESP_OK\) \{\s*return http_deadline_reached\(operation_started, operation_deadline\) \? ESP_ERR_TIMEOUT\s*: e;/,
        "if (e != ESP_OK) {\n            return e;")],
    ["initial firmware-open timeout is mislabeled as reachability", () =>
      replaceOnce("main/ota_update.cpp",
        /e\s*==\s*ESP_ERR_TIMEOUT\s*\?\s*"Update download timed out"/,
        'false ? "Update download timed out"')],
    ["range-resume open timeout is mislabeled as a read failure", () =>
      replaceOnce("main/ota_update.cpp",
        /(diag_printf\("ota: range resume open failed[\s\S]{0,400}?)transfer_failure\s*=\s*e == ESP_ERR_TIMEOUT \? OtaTransferFailure::Timeout\s*: OtaTransferFailure::Read;/,
        "$1transfer_failure = OtaTransferFailure::Read;")],
    ["range resume asks for the image from byte zero", () =>
      replaceOnce("main/ota_update.cpp", "\"bytes=%llu-\"", "\"bytes=0-\"")],
    ["range resume accepts a full 200 response", () =>
      replaceOnce("main/ota_update.cpp",
        "open_firmware_stream(client, response_state, socket_deadline, 206, transfer_started,",
        "open_firmware_stream(client, response_state, socket_deadline, 200, transfer_started,")],
    ["range resume ignores the exact Content-Range", () =>
      replaceOnce("main/ota_update.cpp", /const bool\s+range_ok\s*=\s*ota_content_range_matches\(/,
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
        "socket_deadline.arm(c, manifest_started, kManifestDeadline)",
        "socket_deadline.arm_bypassed(c, manifest_started, kManifestDeadline)")],
    ["manifest header shutdown is ignored", () =>
      replaceOnce("main/ota_update.cpp",
        /(esp_http_client_fetch_headers\(c\);[\s\S]{0,120}?)socket_deadline\.expired\(\)/,
        "$1false")],
    ["firmware streams no longer arm the absolute socket watchdog", () =>
      replaceOnce("main/ota_update.cpp",
        "socket_deadline.arm(client, operation_started, operation_deadline)",
        "socket_deadline.arm_bypassed(client, operation_started, operation_deadline)")],
    ["a trickling image header can hold the network heap forever", () =>
      replaceOnce("main/ota_update.cpp",
        "!set_http_timeout_to_deadline(client, transfer_started, kFirmwareDeadline)",
        "false")],
    ["a trickling firmware body can hold the network heap forever", () =>
      replaceOnce("main/ota_update.cpp",
        /(while \(transfer_ok\) \{[\s\S]{0,180}?)!set_http_timeout_to_deadline\(client, transfer_started, kFirmwareDeadline\)/,
        "$1false")],
    ["a trickling weather response can hold the network heap forever", () =>
      replaceOnce("main/weather_forecast.cpp",
        "socket_deadline.arm(client, download_started, kDownloadDeadline)",
        "socket_deadline.arm_bypassed(client, download_started, kDownloadDeadline)")],
    ["manifest deadline expiry after a blocking read is mislabeled", () =>
      replaceOnce("main/ota_update.cpp",
        /(esp_http_client_read\(c,[\s\S]{0,220}?)socket_deadline\.expired\(\)/,
        "$1false")],
    ["a truncated manifest body is accepted", () =>
      replaceOnce("main/ota_update.cpp",
        /http_body_complete\(claimed,\s*got,\s*esp_http_client_is_complete_data_received\(c\)\)/,
        "true")],
    ["an oversized unknown-length manifest hides behind its first 2 KiB", () =>
      replaceOnce("main/ota_update.cpp", "esp_http_client_read(c, &extra, 1)",
        "esp_http_client_read(c, &extra, 0)")],
    ["manifest identity accepts garbage after the root", () =>
      replaceOnce("main/logic/ota_manifest.hpp",
        "return i == len && have_version && have_provenance && have_sha;",
        "return have_version && have_provenance && have_sha;")],
    ["manifest identity no longer requires strict root member separators", () =>
      replaceOnce("main/logic/ota_manifest.hpp",
        /(if \(i < len && json\[i\] == '\}'\) \{\n\s*\+\+i;\n\s*break;\n\s*\}\n\s*)return false;/,
        "$1continue;")],
    ["manifest provenance no longer requires its matching object closer", () =>
      replaceOnce("main/logic/ota_manifest.hpp",
        /(auto parse_provenance[\s\S]{0,1800}?if \(pos < len && json\[pos\] == )'\}'/,
        "$1']'")],
    ["image-header deadline expiry after a blocking read is mislabeled", () =>
      replaceOnce("main/ota_update.cpp",
        /(while \(probe_len < kImageProbeSize\)[\s\S]{0,700}?)socket_deadline\.expired\(\)/,
        "$1false")],
    ["firmware-body deadline expiry after a blocking read is mislabeled", () =>
      replaceOnce("main/ota_update.cpp",
        /(while \(transfer_ok\)[\s\S]{0,700}?)socket_deadline\.expired\(\)/,
        "$1false")],
    ["weather deadline expiry after a blocking read is mislabeled", () =>
      replaceOnce("main/weather_forecast.cpp",
        /(esp_http_client_read\(client, chunk, sizeof\(chunk\)\);[\s\S]{0,160}?)socket_deadline\.expired\(\)/,
        "$1false")],
    ["a truncated Weather body is accepted as fresh", () =>
      replaceOnce("main/weather_forecast.cpp",
        /http_body_complete\(\s*claimed,\s*out\.size\(\),\s*esp_http_client_is_complete_data_received\(client\)\)/,
        "true")],
    ["Weather accepts garbage after a valid JSON root", () =>
      replaceOnce("main/weather_forecast.cpp", "!json_suffix_is_whitespace(",
        "false && !json_suffix_is_whitespace(")],
    ["Weather cleanup closes before joining the socket watchdog", () =>
      replaceOnce("main/weather_forecast.cpp", "(void)deadline.disarm();",
        "(void)deadline.disarm_bypassed();")],
    ["HTTP cleanup before validation disappears", () =>
      replaceOnce("main/ota_update.cpp",
        /(\/\/ CRITICAL ORDERING:[\s\S]{0,900}?buffer = nullptr;\n    )close_http_client\(client, socket_deadline\);/,
        "$1close_http_client_after_validation(client, socket_deadline);")],
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
        /(err\s*=\s*retryable_allocator_failure\s*)\? "Not enough memory for update TLS — retry after reboot"/,
        "$1? \"Can't reach the update server\"")],
    ["firmware TLS allocation failure is mislabeled as server reachability", () =>
      replaceOnce("main/ota_update.cpp",
        /(set_state\("error", allocator_failure\s*)\? "Not enough memory for update TLS — retry after reboot"/,
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
        "mqtt_transport_pause_if_requested();\n    s_publish_network_quiesced.store(true, std::memory_order_release);\n    vTaskDelay",
        "mqtt_transport_pause_if_requested();\n    s_publish_network_quiesced.store(false, std::memory_order_release);\n    vTaskDelay")],
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
        "state.wait_s = state.backoff_s;",
        "state.wait_s = 0;")],
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
    ["values wait ignores OTA becoming active behind Weather", () =>
      replaceOnce("main/http_status.cpp", "const bool ota_active     = ota_download_active();",
        "const bool ota_active     = false;")],
    ["values wait tears the Weather-to-OTA hand-off", () =>
      replaceOnce(
        "main/http_status.cpp",
        "const bool weather_active = weather_fetch_active();\n        const bool ota_active     = ota_download_active();",
        "const bool ota_active     = ota_download_active();\n        const bool weather_active = weather_fetch_active();",
      )],
    ["values snapshots no longer wait behind a weather TLS owner", () =>
      replaceOnce("main/http_status.cpp", "const bool weather_active = weather_fetch_active();",
        "const bool weather_active = false;")],
    ["the values TLS wait exceeds the live request timeout", () =>
      replaceOnce("main/http_status.cpp", "pdMS_TO_TICKS(4000)",
        "pdMS_TO_TICKS(6000)")],
    ["the values snapshot bypasses its TLS-owner wait", () =>
      replaceOnce(
        "main/http_status.cpp",
        /(esp_err_t http_send_values_json\([\s\S]{0,520}?)if \(!wait_for_values_tls_owner\(\) \|\|/,
        "$1if (!wait_for_values_tls_owner_bypassed() ||",
      )],
    ["the values snapshot drops its final OTA recheck", () =>
      replaceOnce(
        "main/http_status.cpp",
        /(esp_err_t http_send_values_json\([\s\S]{0,520}?if \(!wait_for_values_tls_owner\(\) \|\| )ota_download_active\(\)/,
        "$1false",
      )],
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
      replaceOnce("main/http_ota.cpp", /j \+= ",\\"busy\\":";\s*j \+= s\.busy \? "true" : "false";/,
        'j += ",\\"busy\\":false";')],
    ["an update can consume a replaced check generation", () =>
      replaceOnce("main/ota_update.cpp", "s_generation != after_generation",
        "false")],
    ["accepted artifact identity is dropped before worker notification", () =>
      replaceOnce("main/ota_update.cpp", /s_task_args\s*=\s*request;/,
        "s_task_args = OtaTaskArgs{};")],
    ["accepted OTA work no longer wakes the boot-resident worker", () =>
      replaceOnce("main/ota_update.cpp", "xTaskNotifyGive(s_ota_task);",
        "(void)s_ota_task;")],
    ["the downloaded byte stream is no longer hashed", () =>
      replaceOnce("main/ota_update.cpp", "psa_hash_update(&hash_operation, data, len)",
        "psa_hash_update_bypassed(&hash_operation, data, len)")],
    ["the exact downloaded application SHA is ignored", () =>
      replaceOnce("main/ota_update.cpp", "!ota_sha256_matches(actual_sha256, request.offer.app_sha256.data())",
        "false")],
    ["the update endpoint no longer requires the checked SHA", () =>
      replaceOnce("main/http_ota.cpp", 'httpd_query_key_value(q, "sha256", app_sha256, sizeof(app_sha256))',
        'httpd_query_key_value(q, "ignored", app_sha256, sizeof(app_sha256))')],
    ["OTA status copies allocate a dynamic SHA string during TLS pressure", () =>
      replaceOnce("main/ota_update.hpp", "std::array<char, 65> available_sha256{};",
        "std::string available_sha256;")],
    ["OTA status copies allocate dynamic message text during TLS pressure", () =>
      replaceOnce("main/ota_update.hpp", /FixedText<128>\s+message;/,
        "std::string message;")],
    ["OTA status copies the complete string-owning Config", () =>
      replaceOnce("main/ota_update.cpp", "ota_channel_name(config_ota_channel())",
        "ota_channel_name(config().ota_channel)")],
    ["OTA status response grows a dynamic JSON string during TLS pressure", () =>
      replaceOnce("main/http_ota.cpp", "FixedBuffer<4096> j;",
        "std::string j;")],
    ["OTA status hides the sampled transfer low-water", () =>
      replaceOnce("main/http_ota.cpp", 'j += ",\\"heap_min_free_bytes\\":";',
        'j += ",\\"heap_min_free_bytes_hidden\\":";')],
    ["OTA status hides the pre-reboot task-stack watermark", () =>
      replaceOnce("main/http_ota.cpp", 'j += ",\\"ota_stack_min_free_bytes\\":";',
        'j += ",\\"ota_stack_min_free_bytes_hidden\\":";')],
    ["OTA heap checkpoints stop sampling the task stack", () =>
      replaceOnce("main/ota_update.cpp", "stack_watch_sample(StackWatch::Ota);",
        "stack_watch_sample_bypassed(StackWatch::Ota);")],
    ["successful boot selection stops sampling the task stack", () =>
      replaceOnce("main/ota_update.cpp",
        '    stack_watch_sample(StackWatch::Ota);\n\n    diag_printf("ota: installed',
        '    stack_watch_sample_bypassed(StackWatch::Ota);\n\n    diag_printf("ota: installed')],
    ["busy OTA checks derive the default feed before refusing", () =>
      replaceOnce("main/ota_update.cpp",
        "        if (s_busy || !s_ota_task) return 0;\n    }\n    const OtaChannel channel = config_ota_channel();",
        "        if (false) return 0;\n    }\n    const OtaChannel channel = config_ota_channel();")],
    ["default OTA feed resolution reintroduces dynamic strings", () =>
      replaceOnce("main/logic/ota_hil_feed.hpp",
        "    OtaFeedUrls candidate{};\n    if (channel == OtaChannel::Release)",
        "    OtaFeedUrls candidate{};\n    std::string dynamic_feed;\n    if (channel == OtaChannel::Release)")],
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
    ["the cumulative changelog is no longer selected after TLS closes", () =>
      replaceOnce("main/ota_update.cpp",
        "ota_changelog_select_range(document.get(), running_version, expected_version)",
        "ota_changelog_select_range_bypassed(document.get(), running_version, expected_version)")],
    ["the filtered changelog length is not remeasured", () =>
      replaceOnce("main/ota_update.cpp",
        "        return {};\n    decoded_len = std::strlen(document.get());",
        "        return {};\n    decoded_len = got;")],
    ["the cumulative changelog selector allocates dynamic storage", () =>
      replaceOnce("main/logic/ota_changelog_range.hpp",
        "    size_t selected_offset = 0;",
        "    std::string dynamic_history;\n    size_t selected_offset = 0;")],
    ["the cumulative changelog is copied with an overlapping-unsafe primitive", () =>
      replaceOnce("main/logic/ota_changelog_range.hpp", "std::memmove(text,",
        "std::memcpy(text,")],
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
    ["changelog headers no longer arm the absolute socket watchdog", () =>
      replaceOnce("main/ota_update.cpp",
        "socket_deadline.arm(c, changelog_started, kChangelogDeadline)",
        "socket_deadline.arm_bypassed(c, changelog_started, kChangelogDeadline)")],
    ["changelog body shutdown is ignored", () =>
      replaceOnce("main/ota_update.cpp",
        /(esp_http_client_read\(c, document\.get\(\) \+ got,[\s\S]{0,220}?)socket_deadline\.expired\(\)/,
        "$1false")],
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
