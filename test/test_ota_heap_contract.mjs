// Source-boundary contract for the signed-OTA heap fix.
//
// The host C++ suite can prove the pure headroom predicate and the bounded quiesce counter, but it
// cannot link ESP-IDF and therefore cannot prove the load-bearing orchestration: the image client
// must release HTTP/TLS before RSA validation, both headroom gates must sit on the install path,
// the boot partition must move only after esp_ota_end accepted the signed image, and the allocation-
// rich X10A poll must stand aside without turning an intentional hold into an OOM skip. Those are
// whole-component claims, so this test reads the production call sites.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const defaultRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
// The override is used only by tools/ota/selftest.mjs to run this exact contract against mutations
// in a throwaway tree. Keeping one checker avoids a ceremonial selftest that re-implements a weaker
// rule than CI actually runs.
const root = path.resolve(process.env.OTA_CONTRACT_ROOT || defaultRoot);
const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");
const code = (rel) => read(rel)
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .split("\n")
  .filter((line) => !line.trim().startsWith("//"))
  .join("\n");
const occurrences = (text, token) => text.split(token).length - 1;

const ota = code("main/ota_update.cpp");
const httpOta = code("main/http_ota.cpp");
const mqtt = code("main/mqtt_ha.cpp");
const poll = code("main/hp_poll.cpp");
// Keep this source verbatim: it contains the legitimate captive-portal URI string "/*", which a
// regex comment stripper would mistake for an unterminated block comment and erase most handlers.
const httpStatus = read("main/http_status.cpp");
const headroom = code("main/logic/ota_headroom.hpp");
const transport = code("main/logic/ota_transport.hpp");
const sdkconfig = read("sdkconfig.defaults");

// ── HTTP acceptance is the authoritative OTA operation boundary ──────────────────────────────
// An asynchronous check/update request is not successful merely because the HTTP handler ran.
// The OTA mutex claim and operation generation are created together; busy/task-creation refusal
// must be non-2xx, and status exposes the same mutex-protected generation+busy snapshot.
assert.match(ota,
  /uint32_t\s+start\([^)]*\)[\s\S]{0,500}?if\s*\(s_busy\)\s*return 0;[\s\S]{0,220}?generation\s*=\s*\+\+s_generation/,
  "OTA start must atomically refuse busy and assign a non-zero operation generation");
assert.match(ota,
  /uint32_t\s+ota_check_async[\s\S]{0,300}?return generation;[\s\S]{0,1200}?uint32_t\s+ota_update_async[\s\S]{0,300}?return generation;/,
  "both asynchronous operations must return their accepted generation to HTTP");
assert.equal(occurrences(httpOta, '503 Service Unavailable'), 2,
  "busy or unavailable check/update starts must both be HTTP non-success");
assert.equal(occurrences(httpOta, '{\\"ok\\":true,\\"generation\\":%lu}'), 2,
  "both accepted operation responses must carry their generation token");
assert.match(httpOta,
  /,\\"busy\\":.*s\.busy[\s\S]{0,180}?,\\"generation\\":.*std::to_string\(s\.generation\)/,
  "status must expose the mutex-consistent busy and generation handshake");

// ── The verifier remains mandatory ────────────────────────────────────────────────────────────
// esp_ota_end() is the ESP-IDF boundary that performs image verification under these Kconfig
// settings. A heap fix that bypasses it or weakens signed-on-update merely trades a retry for an
// unauthenticated firmware path, which is never an acceptable recovery.
for (const setting of [
  "CONFIG_SECURE_SIGNED_APPS_NO_SECURE_BOOT=y",
  "CONFIG_SECURE_SIGNED_APPS_RSA_SCHEME=y",
  "CONFIG_SECURE_SIGNED_ON_UPDATE_NO_SECURE_BOOT=y",
]) {
  assert.equal(sdkconfig.split("\n").filter((line) => line.trim() === setting).length, 1,
    `${setting} must remain enabled exactly once`);
}
assert.match(sdkconfig, /^CONFIG_SECURE_BOOT_BUILD_SIGNED_BINARIES=n$/m,
  "CI, not a developer build, must continue to sign the finished image");
assert.doesNotMatch(ota, /esp_https_ota_(?:begin|perform|finish)\s*\(/,
  "the opaque HTTPS helper cannot release its TLS heap before its built-in validation step");

const updateStart = ota.indexOf("void run_update(");
const updateEnd = ota.indexOf("const char kUpdateMode", updateStart);
assert.ok(updateStart >= 0 && updateEnd > updateStart,
  "the OTA install boundary must remain identifiable");
const update = ota.slice(updateStart, updateEnd);

const init = update.indexOf("esp_http_client_init(");
const probeRead = update.indexOf("esp_http_client_read(", init);
const begin = update.indexOf("esp_ota_begin(");
const writeImage = update.indexOf("esp_ota_write(", begin);
const probeWrite = update.indexOf("write_chunk(buffer, probe_len)", writeImage);
const bulkRead = update.indexOf("esp_http_client_read(", probeWrite);
const bulkWrite = update.indexOf("write_chunk(buffer,", bulkRead);
const release = update.lastIndexOf("close_http_client(client)");
const verify = update.indexOf("esp_ota_end(");
const select = update.indexOf("esp_ota_set_boot_partition(");
assert.ok(init >= 0 && begin > init && probeRead > begin && writeImage > probeRead &&
          probeWrite > writeImage && bulkRead > probeWrite && bulkWrite > bulkRead,
  "the firmware image must stream from esp_http_client into the inactive OTA partition");
assert.ok(release > bulkWrite && verify > release && select > verify,
  "HTTP/TLS must be closed and cleaned before signature validation, and boot selection must follow it");
const closeHelperStart = ota.indexOf("void close_http_client(");
const closeHelperEnd = ota.indexOf("esp_err_t open_firmware_stream(", closeHelperStart);
assert.ok(closeHelperStart >= 0 && closeHelperEnd > closeHelperStart,
  "the HTTP/TLS release helper must remain identifiable");
const closeHelper = ota.slice(closeHelperStart, closeHelperEnd);
assert.ok(closeHelper.indexOf("esp_http_client_close(") <
          closeHelper.indexOf("esp_http_client_cleanup("),
  "the image-client release must close the connection before destroying its TLS/client state");
assert.match(closeHelper, /client\s*=\s*nullptr/,
  "the release helper must invalidate the destroyed client handle");
assert.equal(occurrences(update, "esp_ota_end("), 1,
  "the downloaded image must cross exactly one validation boundary");
assert.equal(occurrences(update, "esp_ota_set_boot_partition("), 1,
  "there must be one post-validation boot-selection path");
assert.match(update.slice(verify, select),
  /if\s*\(\s*(?:e|err|end_err|verify_err)\s*!=\s*ESP_OK\s*\)[\s\S]*?return\s*;/,
  "a failed esp_ota_end must return before the boot partition can move");

// ── The transport cannot downgrade out of HTTPS ──────────────────────────────────────────────
// Signature validation protects firmware authenticity, but it does not make an arbitrary clear-
// text response cheap or private. Initial manifest and image URLs are absolute HTTPS only. A
// redirect may be an ordinary relative reference, but never another scheme, a protocol-relative
// authority or a parser-confusing control/backslash; HTTP transport is forced to TLS as a second
// line of defence.
assert.match(transport,
  /if\s*\(ota_url_is_absolute_https\(value\)\)\s*return true;/,
  "redirect policy must delegate its only absolute-URL allowance to the HTTPS-only rule");
assert.match(transport,
  /value\.size\(\)\s*>=\s*2\s*&&\s*value\[0\]\s*==\s*'\/'\s*&&\s*value\[1\]\s*==\s*'\/'/,
  "protocol-relative redirects must be rejected instead of hiding an authority switch");
assert.match(transport, /c\s*<=\s*0x20\s*\|\|\s*c\s*==\s*0x7f\s*\|\|\s*c\s*==\s*'\\\\'/,
  "URL policy must reject whitespace, controls and backslash parser ambiguities");

const manifestStart = ota.indexOf("bool fetch_manifest_version_once(");
const manifestEnd = ota.indexOf("bool fetch_manifest_version(", manifestStart);
assert.ok(manifestStart >= 0 && manifestEnd > manifestStart,
  "the manifest fetch boundary must remain identifiable");
const manifestFetch = ota.slice(manifestStart, manifestEnd);
const manifestHttps = manifestFetch.indexOf("ota_url_is_absolute_https(url)");
const manifestInit = manifestFetch.indexOf("esp_http_client_init(");
assert.ok(manifestHttps >= 0 && manifestInit > manifestHttps,
  "a manifest URL must pass absolute HTTPS policy before a client is allocated");
assert.match(manifestFetch, /transport_type\s*=\s*HTTP_TRANSPORT_OVER_SSL/,
  "manifest fetch must force the SSL transport even after the URL policy passes");
assert.match(manifestFetch, /disable_auto_redirect\s*=\s*true/,
  "manifest fetch must refuse redirects instead of delegating policy to the client");

const firmwareHttps = update.indexOf("ota_url_is_absolute_https(url)");
assert.ok(firmwareHttps >= 0 && init > firmwareHttps,
  "a firmware URL must pass absolute HTTPS policy before a client is allocated");
assert.match(update, /transport_type\s*=\s*HTTP_TRANSPORT_OVER_SSL/,
  "firmware fetch must force the SSL transport");
assert.match(update, /disable_auto_redirect\s*=\s*true/,
  "firmware fetch must disable automatic redirects so only the checked Location path can follow");
assert.match(update, /event_handler\s*=\s*firmware_http_event/,
  "firmware redirects must be inspected before the client follows them");
assert.match(update, /user_data\s*=\s*&redirect_policy/,
  "the HTTP callback must receive the per-operation redirect verdict");

const eventStart = ota.indexOf("esp_err_t firmware_http_event(");
const eventEnd = ota.indexOf("esp_err_t open_firmware_stream(", eventStart);
assert.ok(eventStart >= 0 && eventEnd > eventStart,
  "the redirect-header policy boundary must remain identifiable");
const event = ota.slice(eventStart, eventEnd);
assert.match(event, /HTTP_EVENT_ON_HEADER/,
  "only received response headers may update redirect policy");
assert.match(event, /ota_ascii_prefix_ieq\(key,\s*"Location"\)/,
  "Location matching must be ASCII case-insensitive");
assert.match(event, /ota_redirect_location_observe\(\*policy,\s*event->header_value\)/,
  "every redirect Location header must enter the duplicate-aware policy");

assert.match(transport,
  /if\s*\(state\.location_count\s*<\s*2\)\s*\+\+state\.location_count/,
  "redirect Location counting must saturate only after distinguishing duplicates");
assert.match(transport,
  /if\s*\(state\.location_count\s*==\s*1\)[\s\S]*?state\.location_secure\s*=\s*ota_url_is_https_or_relative\(value\)[\s\S]*?else\s*state\.location_secure\s*=\s*false/,
  "the first Location may be checked, but every duplicate must latch the response insecure");
assert.match(transport,
  /return\s+state\.location_count\s*==\s*1\s*&&\s*state\.location_secure/,
  "a redirect response must contain exactly one secure Location header");

const streamStart = eventEnd;
const streamEnd = ota.indexOf("void set_state(", streamStart);
assert.ok(streamEnd > streamStart, "the redirect-follow loop must remain identifiable");
const stream = ota.slice(streamStart, streamEnd);
assert.match(stream, /redirects\s*<=\s*kMaxRedirects/,
  "redirect following must remain bounded");
const redirectReset = stream.indexOf("ota_redirect_location_reset(policy)");
const redirectVerdict = stream.indexOf("!ota_redirect_location_accepted(policy)");
const setRedirect = stream.indexOf("esp_http_client_set_redirection(");
const redirectClose = stream.indexOf("esp_http_client_close(", setRedirect);
const clearResponse = stream.indexOf("esp_http_client_clear_response_buffer(", redirectClose);
assert.ok(redirectReset >= 0 && redirectVerdict > redirectReset && setRedirect > redirectVerdict &&
          redirectClose > setRedirect &&
          clearResponse > redirectClose,
  "only one unambiguous secure Location may be applied, then the old response/socket must be cleared before reopen");

// ── Headroom is a two-dimensional, two-boundary gate ─────────────────────────────────────────
// Total free bytes alone missed the incident: the failing board still had memory in aggregate but
// only a 632-byte largest block. Conversely, a single large block does not pay all verifier
// allocations. The pure rule therefore requires BOTH, and the update path asks it before claiming
// the transfer resources and again after releasing TLS immediately before RSA validation.
assert.match(headroom,
  /return\s+free_bytes\s*>=\s*OTA_VERIFY_MIN_FREE_BYTES\s*&&\s*largest_free_block\s*>=\s*OTA_VERIFY_MIN_LARGEST_BLOCK_BYTES\s*;/,
  "OTA verification headroom must require both total-free and largest-contiguous thresholds");
assert.match(headroom, /OTA_VERIFY_MIN_FREE_BYTES\s*=\s*24\s*\*\s*1024/,
  "the total-free verifier budget must remain the measured 24 KiB floor");
assert.match(headroom, /OTA_VERIFY_MIN_LARGEST_BLOCK_BYTES\s*=\s*12\s*\*\s*1024/,
  "the contiguous verifier budget must remain the measured 12 KiB floor");
assert.equal(occurrences(update, "wait_for_ota_verify_headroom("), 2,
  "the install path needs one headroom gate before transfer and one before validation");
const firstHeadroom = update.indexOf("wait_for_ota_verify_headroom(");
const secondHeadroom = update.indexOf("wait_for_ota_verify_headroom(", firstHeadroom + 1);
assert.ok(firstHeadroom < init && secondHeadroom > release && secondHeadroom < verify,
  "headroom gates must enclose the transfer and directly protect post-TLS validation");
const sampleStart = ota.indexOf("OtaHeapSample ota_heap_sample(");
const sampleEnd = ota.indexOf("bool wait_for_ota_verify_headroom(", sampleStart);
assert.ok(sampleStart >= 0 && sampleEnd > sampleStart,
  "the device headroom sampler must remain identifiable");
const sample = ota.slice(sampleStart, sampleEnd);
assert.match(sample, /heap_caps_get_free_size\([^)]*MALLOC_CAP_INTERNAL[^)]*\)/,
  "the total-free verifier budget must sample internal 8-bit heap, not PSRAM/default aggregate");
assert.match(sample, /heap_largest_internal_block\(\)/,
  "the device gate must sample internal free heap and the shared internal largest-block metric");

// Bounded retry is deliberate: short-lived allocator churn may clear, but OTA must return control
// instead of waiting forever. The exact five-second ceiling is pinned by sample count × interval in
// ota_update.cpp; the pure thresholds above remain independent of scheduler timing.
assert.match(ota, /kVerifyHeadroomRetryDelay\s*=\s*pdMS_TO_TICKS\(250\)/,
  "headroom retries must use the bounded 250 ms sampling cadence");
assert.match(ota, /kVerifyHeadroomMaxAttempts\s*=\s*20/,
  "headroom retries must stop after about five seconds");
assert.match(ota,
  /for\s*\(\s*unsigned\s+attempt\s*=\s*0\s*;\s*attempt\s*<\s*kVerifyHeadroomMaxAttempts\s*;\s*\+\+attempt\s*\)/,
  "the retry loop must be bounded by the fixed attempt budget");
const memoryMessages = [...update.matchAll(/"(Not enough memory to verify the update[^"\n]*)"/g)]
  .map((match) => match[1]);
assert.ok(memoryMessages.length >= 3,
  "transfer gate, download allocation and validation gate need the same memory diagnosis");
assert.ok(memoryMessages.every((message) => message.includes("retry after reboot")),
  "every verifier-memory refusal must be explicitly retryable and actionable");

// ESP_ERR_OTA_VALIDATE_FAILED is an umbrella result: it covered allocator failure during RSA on the
// live board, not only tampering. Do not turn it back into a cryptographic accusation. The actual
// verifier error remains in diagnostics, while the UI gets the accurate generic failure class.
assert.doesNotMatch(ota, /bad signature|SIGNATURE VERIFICATION FAILED/i,
  "a generic IDF validation error must never be reported as proof of a bad signature");
assert.match(update, /Update rejected: image validation failed/,
  "esp_ota_end failure must use the generic image-validation diagnosis");
assert.match(update.slice(verify, select), /esp_err_to_name\(/,
  "the generic user message must retain the concrete IDF error in diagnostics");

// A response larger than its declared Content-Length or the inactive partition is not a network
// truncation. Keep it as a fail-closed size-class refusal even though the same early stop naturally
// makes esp_http_client report incomplete data.
assert.match(ota, /enum class OtaTransferFailure[^}]*None[^}]*Read[^}]*Write[^}]*Size/,
  "transfer failures must retain an explicit size/overrun class");
assert.match(update,
  /written\s*\+\s*len\s*>[\s\S]*?ESP_ERR_INVALID_SIZE;[\s\S]*?transfer_failure\s*=\s*OtaTransferFailure::Size;/,
  "a declared-length or partition overrun must become ESP_ERR_INVALID_SIZE and class Size");
assert.match(update,
  /transfer_failure\s*==\s*OtaTransferFailure::Size[\s\S]*?Update rejected: image size is invalid[\s\S]*?!complete\s*\?/,
  "size refusal must outrank the incomplete-transfer fallback in the user diagnosis");

// Every failure returns through ota_task, whose single epilogue releases s_busy. That is what makes
// the memory refusal retryable without a power-cycle-only latch.
const taskStart = ota.indexOf("void ota_task(");
const taskEnd = ota.indexOf("uint32_t start(", taskStart);
assert.ok(taskStart >= 0 && taskEnd > taskStart, "the OTA task epilogue must remain identifiable");
const task = ota.slice(taskStart, taskEnd);
assert.ok(task.indexOf("run_update(") < task.lastIndexOf("s_busy = false"),
  "all install exits must release the one-operation guard so the user can retry");

// ── X10A polling stands aside, but only for the existing bounded budget ───────────────────────
// MQTT already used ota_quiesce_step(). The live failure proved that poll_once() also competes for
// the same heap by constructing its value vector. Its hold must occur before config/poll allocation,
// feed the watchdog, delay at the ordinary cadence, and continue without incrementing poll_skipped:
// this is intentional coordination, not an exception/OOM.
const pollStart = poll.indexOf("static void poll_task(");
const pollEnd = poll.indexOf("void hp_poll_start()", pollStart);
assert.ok(pollStart >= 0 && pollEnd > pollStart, "the X10A poll task must remain identifiable");
const pollTask = poll.slice(pollStart, pollEnd);
assert.match(pollTask, /OtaQuiesceState\s+network_quiesce/,
  "the poll task must own an independent bounded network hold-off counter");
const active = pollTask.indexOf("ota_download_active(");
const weatherActive = pollTask.indexOf("weather_fetch_active(", active);
const quiesce = pollTask.indexOf("ota_quiesce_step(network_quiesce, network_active)", weatherActive);
const configRead = pollTask.indexOf("config().profile");
const pollOnce = pollTask.indexOf("poll_once(");
assert.ok(active >= 0 && weatherActive > active && quiesce > weatherActive &&
          configRead > quiesce && pollOnce > quiesce,
  "the bounded OTA/weather hold must run before allocation-rich config and X10A polling");
const holdEnd = pollTask.indexOf("continue;", quiesce);
assert.ok(holdEnd > quiesce, "a held poll cycle must leave before constructing a snapshot");
const hold = pollTask.slice(quiesce, holdEnd);
const watchdogReset = pollTask.lastIndexOf("esp_task_wdt_reset()", active);
assert.ok(watchdogReset >= 0,
  "an intentional OTA hold must keep the X10A task watchdog fed");
assert.match(hold, /vTaskDelay\(/,
  "an intentional OTA hold must yield at the normal poll cadence");
assert.match(hold, /s_network_quiesced\.store\(true,\s*std::memory_order_release\)/,
  "the held poll path must acknowledge that its allocation-rich cycle has ended");
assert.doesNotMatch(hold, /s_cycles_skipped\.fetch_add/,
  "intentional OTA holds must not masquerade as allocation failures");
assert.match(pollTask.slice(holdEnd, configRead),
  /s_network_quiesced\.store\(false,\s*std::memory_order_release\)/,
  "polling must withdraw its acknowledgement before allocation-rich work resumes");

const pollAckStart = poll.indexOf("bool hp_poll_network_quiesced(");
const pollAckEnd = poll.indexOf("bool hp_poll_ota_quiesced(", pollAckStart);
assert.ok(pollAckStart >= 0 && pollAckEnd > pollAckStart,
  "the lock-free poll acknowledgement boundary must remain identifiable");
const pollAck = poll.slice(pollAckStart, pollAckEnd);
assert.match(pollAck,
  /!s_poll_task_running\.load\(std::memory_order_acquire\)\s*\|\|\s*s_network_quiesced\.load\(std::memory_order_acquire\)/,
  "no poll task is already quiescent; a running one must explicitly acknowledge the hold");

const mqttAckStart = mqtt.indexOf("bool mqtt_publish_network_quiesced(");
const mqttAckEnd = mqtt.indexOf("ReferenceTemperatureStatus reference_temperature_status(", mqttAckStart);
assert.ok(mqttAckStart >= 0 && mqttAckEnd > mqttAckStart,
  "the lock-free MQTT acknowledgement boundary must remain identifiable");
assert.match(mqtt.slice(mqttAckStart, mqttAckEnd),
  /s_publish_network_quiesced\.load\(std::memory_order_acquire\)\s*&&\s*!s_transport_connecting\.load\(std::memory_order_acquire\)/,
  "one authoritative MQTT acknowledgement must cover firmware publishing and esp-mqtt transport TLS");
assert.match(mqtt,
  /case MQTT_EVENT_BEFORE_CONNECT:[\s\S]{0,120}?mqtt_transport_before_connect\(\)/,
  "every asynchronous esp-mqtt connection attempt must enter the shared heap handshake");
assert.match(mqtt,
  /mqtt_transport_before_connect\(\)[\s\S]{0,500}?if\s*\(!s_publish_network_quiesced\.load\(std::memory_order_acquire\)\)[\s\S]{0,160}?s_transport_connecting\.store\(true,\s*std::memory_order_release\)[\s\S]{0,80}?return;/,
  "BEFORE_CONNECT must give an existing publish owner priority instead of deadlocking client_stop");
const mqttTaskStart = mqtt.indexOf("static void mqtt_task(");
const mqttTaskEnd = mqtt.indexOf("static bool build_client(", mqttTaskStart);
assert.ok(mqttTaskStart >= 0 && mqttTaskEnd > mqttTaskStart,
  "the MQTT publish task must remain identifiable");
const mqttTask = mqtt.slice(mqttTaskStart, mqttTaskEnd);
assert.match(mqttTask,
  /ota_quiesce_step\(network_quiesce, network_busy\)[\s\S]{0,600}?s_publish_network_quiesced\.store\(true,\s*std::memory_order_release\)[\s\S]{0,200}?continue;/,
  "the held MQTT path must acknowledge that its allocation-rich cycle has ended");
assert.match(mqtt,
  /struct\s+MqttStartupActivity[\s\S]{0,800}?s_publish_network_quiesced\.store\(false,\s*std::memory_order_release\)[\s\S]{0,300}?if\s*\(!competing_tls_active\(\)\)\s*return;[\s\S]{0,200}?s_publish_network_quiesced\.store\(true,\s*std::memory_order_release\)/,
  "MQTT startup must claim/recheck and yield to an OTA that began before mqtt_ha_start");
assert.match(mqtt,
  /esp_mqtt_client_stop\(s_client\)[\s\S]{0,600}?s_transport_connecting\.store\(false,\s*std::memory_order_release\)[\s\S]{0,600}?esp_mqtt_client_destroy\(s_client\)/,
  "MQTT promotion must clear BEFORE_CONNECT state because client_stop emits no disconnect event");

const pollBarrierStart = ota.indexOf("bool wait_for_poll_quiesce(");
const pollBarrierEnd = ota.indexOf("OtaChannel channel_now()", pollBarrierStart);
assert.ok(pollBarrierStart >= 0 && pollBarrierEnd > pollBarrierStart,
  "the pre-transfer X10A barrier must remain identifiable");
const pollBarrier = ota.slice(pollBarrierStart, pollBarrierEnd);
assert.match(ota, /kPollQuiesceWait\s*=\s*pdMS_TO_TICKS\(15000\)/,
  "a slow in-flight X10A sweep gets a bounded 15-second acknowledgement window");
assert.match(pollBarrier,
  /while\s*\(\s*!hp_poll_ota_quiesced\(\)[\s\S]*?<\s*kPollQuiesceWait\s*\)/,
  "OTA must wait on the acknowledgement only within the bounded window");
const pollBarrierCall = task.indexOf("wait_for_poll_quiesce()");
const mqttBarrierCall = task.indexOf("wait_for_mqtt_quiesce()", pollBarrierCall);
const weatherBarrierCall = task.indexOf("wait_for_weather_quiesce()", mqttBarrierCall);
const updateCall = task.indexOf("run_update(");
assert.ok(pollBarrierCall >= 0 && mqttBarrierCall > pollBarrierCall &&
          weatherBarrierCall > mqttBarrierCall && updateCall > weatherBarrierCall,
  "OTA must receive poll, MQTT and weather quiescence acknowledgements before entering the install path");

// The model-sized /values snapshot is the remaining HTTP allocator that collided with the fresh-
// boot OTA/Weather TLS windows on the 129-row plant. It waits before the snapshot, bounded below the
// live gate's five-second client timeout. Status/diag/OTA status are not themselves gated; only the
// proven values path (and MCP's shared sender) stands aside.
const valuesSendStart = httpStatus.indexOf("esp_err_t http_send_values_json(");
const valuesSendEnd = httpStatus.indexOf("static esp_err_t h_values(", valuesSendStart);
assert.ok(valuesSendStart >= 0 && valuesSendEnd > valuesSendStart,
  "the shared /values + MCP sender must remain identifiable");
const valuesSend = httpStatus.slice(valuesSendStart, valuesSendEnd);
const valuesWait = valuesSend.indexOf("wait_for_values_tls_owner()");
const valuesSnapshot = valuesSend.indexOf("take_values_snapshot()", valuesWait);
assert.ok(valuesWait >= 0 && valuesSnapshot > valuesWait,
  "/values must finish its bounded TLS-owner wait before allocating the model-sized snapshot");
assert.match(valuesSend,
  /if\s*\(!wait_for_values_tls_owner\(\)\)\s*return values_tls_busy\(req\);/,
  "a timed-out TLS-owner wait must fail closed before the values snapshot allocation");
assert.equal(occurrences(httpStatus, "wait_for_values_tls_owner()"), 2,
  "only the wait helper and the shared values sender may use the values-only gate");
assert.match(httpStatus,
  /values_tls_busy\(httpd_req_t\* req\)[\s\S]*?503 Service Unavailable[\s\S]*?text\/plain[\s\S]*?network operation in progress/,
  "the bounded refusal must stay a small explicit pre-response busy-503");
assert.match(httpStatus,
  /http_values_wait_decision\(\s*ota_download_active\(\),\s*weather_fetch_active\(\)/,
  "the values wait must observe both lock-free firmware TLS owners independently");
assert.match(httpStatus, /kValuesTlsWait\s*=\s*pdMS_TO_TICKS\(4000\)/,
  "the values wait must remain below the five-second live-gate request timeout");
assert.match(httpStatus, /kValuesTlsRetry\s*=\s*pdMS_TO_TICKS\(250\)/,
  "the values wait must yield in bounded 250-ms steps");
const statusStart = httpStatus.indexOf("static esp_err_t h_status(");
const statusEnd = httpStatus.indexOf("struct ValuesSnapshot", statusStart);
assert.ok(statusStart >= 0 && statusEnd > statusStart &&
          !httpStatus.slice(statusStart, statusEnd).includes("wait_for_values_tls_owner"),
  "/status must stay outside the values-only TLS wait so health and OTA progress remain observable");

console.log("OTA heap: TLS-before-verify release, dual headroom gate, signed validation, bounded " +
            "poll/MQTT/values quiesce and retryable diagnostics are pinned");
