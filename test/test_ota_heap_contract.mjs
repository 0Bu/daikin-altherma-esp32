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
const otaHeader = code("main/ota_update.hpp");
const httpOta = code("main/http_ota.cpp");
const mqtt = code("main/mqtt_ha.cpp");
const poll = code("main/hp_poll.cpp");
const modbus = code("main/hp_modbus.cpp");
const syslog = code("main/syslog.cpp");
const weather = code("main/weather_forecast.cpp");
const mcp = code("main/mcp_server.cpp");
const httpCommon = code("main/http_common.cpp");
const config = code("main/config.cpp");
// Keep this source verbatim: it contains the legitimate captive-portal URI string "/*", which a
// regex comment stripper would mistake for an unterminated block comment and erase most handlers.
const httpStatus = read("main/http_status.cpp");
const headroom = code("main/logic/ota_headroom.hpp");
const quiesceLogic = code("main/logic/ota_quiesce.hpp");
const transport = code("main/logic/ota_transport.hpp");
const fixedText = code("main/logic/fixed_text.hpp");
const sdkconfig = read("sdkconfig.defaults");

assert.match(quiesceLogic, /OTA_QUIESCE_MAX_CYCLES\s*=\s*600/,
  "poll/MQTT quiescence must outlive the complete bounded OTA path and 480-second host observer");

const allHandlerStart = httpCommon.indexOf("static esp_err_t handle_all(");
const allHandlerEnd = httpCommon.indexOf("void http_register(", allHandlerStart);
const allHandler = httpCommon.slice(allHandlerStart, allHandlerEnd);
const postOtaGate = allHandler.indexOf("req->method == HTTP_POST && ota_busy()");
const trustedHeaders = allHandler.indexOf("trusted_lan_headers_allowed(req)");
const jsonPolicy = allHandler.indexOf("json_post_allowed(req)");
assert.ok(allHandlerStart >= 0 && allHandlerEnd > allHandlerStart && postOtaGate >= 0 &&
          trustedHeaders > postOtaGate && jsonPolicy > trustedHeaders,
  "every POST must fail from the synchronously accepted OTA lease before header/body/route allocation");
assert.match(allHandler.slice(postOtaGate, trustedHeaders),
  /503 Service Unavailable[\s\S]{0,150}?Network TLS operation in progress/,
  "the shared OTA POST refusal must be fixed, explicit and retryable");

// ── HTTP acceptance is the authoritative OTA operation boundary ──────────────────────────────
// An asynchronous check/update request is not successful merely because the HTTP handler ran.
// The OTA mutex claim and operation generation are created together; busy/task-creation refusal
// must be non-2xx, status exposes the same mutex-protected generation+busy snapshot, and an update
// can only consume the exact completed check generation plus artifact identity.
const startUpdateAt = ota.indexOf("uint32_t start_update(");
const startUpdateEnd = ota.indexOf("\n}\n\n}  // namespace", startUpdateAt);
assert.ok(startUpdateAt >= 0 && startUpdateEnd > startUpdateAt,
  "the atomic OTA update-acceptance boundary must remain identifiable");
const startUpdate = ota.slice(startUpdateAt, startUpdateEnd);
const acceptanceLock = startUpdate.indexOf("Lock lk(s_mtx)");
const generationLease = startUpdate.indexOf("s_generation != after_generation", acceptanceLock);
const retainedSha = startUpdate.indexOf("s_status.available_sha256.data()", generationLease);
const acceptedTask = startUpdate.indexOf("start_locked(request, after_generation)", retainedSha);
assert.ok(acceptanceLock >= 0 && generationLease > acceptanceLock && retainedSha > generationLease &&
          acceptedTask > retainedSha,
  "OTA update acceptance must atomically consume the exact completed check generation and SHA");
assert.match(ota,
  /uint32_t\s+ota_check_async[\s\S]{0,300}?return generation;[\s\S]{0,1600}?uint32_t\s+ota_update_async[\s\S]{0,500}?return generation;/,
  "both asynchronous operations must return their accepted generation to HTTP");
assert.match(ota,
  /struct OtaTaskArgs[\s\S]{0,300}?char version\[32\][\s\S]{0,100}?char app_sha256\[65\]/,
  "the asynchronous task identity must use fixed channel/version/SHA storage");
assert.match(ota,
  /uint32_t\s+start_locked[\s\S]{0,300}?s_task_args\s*=\s*request;[\s\S]{0,250}?xTaskCreate\(ota_task/,
  "accepted channel/version/SHA must cross the task boundary in one fixed task-owned slot");
assert.match(ota,
  /xTaskCreate\(ota_task[\s\S]{0,250}?s_generation\s*=\s*previous_generation/,
  "a task-creation failure must roll back the attempted generation");
assert.equal(occurrences(httpOta, '503 Service Unavailable'), 2,
  "busy or unavailable check/update starts must both be HTTP non-success");
assert.equal(occurrences(httpOta, '{\\"ok\\":true,\\"generation\\":%lu}'), 2,
  "both accepted operation responses must carry their generation token");
assert.match(httpOta,
  /j\s*\+=\s*",\\"busy\\":"[\s\S]{0,100}?s\.busy[\s\S]{0,100}?j\s*\+=\s*",\\"generation\\":"[\s\S]{0,100}?number\(s\.generation\)/,
  "status must expose the mutex-consistent busy and generation handshake");
for (const field of ["after", "channel", "version", "sha256"]) {
  assert.match(httpOta, new RegExp(`httpd_query_key_value\\(q, "${field}"`),
    `update acceptance must require checked ${field}`);
}
assert.match(httpOta,
  /ota_update_async\(static_cast<uint32_t>\(after_value\), channel,[\s\S]{0,100}?version, app_sha256, downgrade\)/,
  "HTTP must pass the complete checked identity into the atomic firmware boundary");
assert.match(otaHeader, /std::array<char,\s*65>\s+available_sha256/,
  "frequent /ota/status copies must keep the 64-byte artifact SHA in fixed storage");
for (const field of ["state", "message", "available", "available_channel", "current", "channel"]) {
  assert.match(otaHeader, new RegExp(`FixedText<\\d+>\\s+${field}`),
    `/ota/status ${field} must remain fixed-capacity under TLS pressure`);
}
assert.match(fixedText, /class\s+FixedBuffer[\s\S]{0,900}?overflowed_\s*=\s*true/,
  "the OTA JSON buffer must fail closed on overflow instead of reallocating or truncating");
assert.match(httpOta,
  /FixedBuffer<2048>\s+j[\s\S]{0,1800}?json_append_quoted[\s\S]{0,1800}?if\s*\(!j\.ok\(\)\)/,
  "compact OTA status must use bounded allocation-free JSON with explicit overflow handling");
assert.doesNotMatch(httpOta, /std::to_string|json_quote|std::string\s+j/,
  "compact OTA status must not allocate response strings while TLS owns the heap");
assert.match(config,
  /OtaChannel\s+config_ota_channel\(\)[\s\S]{0,120}?Lock lk\(g_mtx\)[\s\S]{0,120}?return g_cfg\.ota_channel/,
  "OTA status must read one config enum without copying the string-owning Config");
assert.match(ota,
  /OtaStatus\s+ota_status\(\)[\s\S]{0,700}?config_ota_channel\(\)/,
  "the live OTA status snapshot must use the allocation-free channel accessor");
assert.match(otaHeader,
  /uint32_t\s+heap_min_free_bytes[\s\S]{0,100}?uint32_t\s+heap_min_largest_block_bytes/,
  "operation-local OTA heap minima must remain fixed-width status fields");
assert.match(httpOta,
  /,\\"heap_min_free_bytes\\":[\s\S]{0,160}?,\\"heap_min_largest_block_bytes\\":/,
  "compact OTA status must expose both operation-local heap dimensions");
assert.match(ota,
  /ota_heap_operation_reset\(\);[\s\S]{0,160}?OtaNetworkFlag active/,
  "each accepted operation must reset heap telemetry before the network phase");
assert.match(ota,
  /void set_progress\([\s\S]{0,220}?ota_heap_sample\(\);[\s\S]{0,120}?s_status\.progress/,
  "firmware transfer progress must sample heap before publishing each percentage");
assert.match(ota,
  /s_status\.heap_min_free_bytes[\s\S]{0,180}?s_operation_min_free\.load[\s\S]{0,180}?s_status\.heap_min_largest_block_bytes[\s\S]{0,180}?s_operation_min_largest\.load/,
  "OTA status must read both lock-free operation minima");

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
const updateEnd = ota.indexOf("uint32_t next_generation(", updateStart);
assert.ok(updateStart >= 0 && updateEnd > updateStart,
  "the OTA install boundary must remain identifiable");
const update = ota.slice(updateStart, updateEnd);
assert.match(ota, /kManifestDeadline\s*=\s*pdMS_TO_TICKS\(30000\)/,
  "a trickling manifest must have a bounded operation deadline");
assert.match(ota, /kFirmwareDeadline\s*=\s*pdMS_TO_TICKS\(5 \* 60 \* 1000\)/,
  "a trickling firmware stream must release quiesced services within five minutes");
const manifestFetchStart = ota.indexOf("bool fetch_manifest_identity_once(");
const manifestFetchEnd = ota.indexOf("bool fetch_manifest_identity(", manifestFetchStart);
const manifestDeadlineFetch = ota.slice(manifestFetchStart, manifestFetchEnd);
assert.ok(manifestFetchStart >= 0 && manifestFetchEnd > manifestFetchStart,
  "the manifest transfer must remain identifiable");
assert.match(manifestDeadlineFetch,
  /while\s*\(got < sizeof\(buf\)\)[\s\S]{0,220}?!set_http_timeout_to_deadline\(c, manifest_started, kManifestDeadline\)/,
  "manifest reads must consume the remaining operation deadline rather than only per-read timeouts");
assert.match(manifestDeadlineFetch,
  /esp_http_client_read\(c,[\s\S]{0,160}?n <= 0[\s\S]{0,160}?http_deadline_reached\(manifest_started, kManifestDeadline\)[\s\S]{0,160}?timed_out = true/,
  "a manifest read which consumes its remaining timeout must retain timeout diagnostics");
const probeLoop = update.slice(update.indexOf("while (probe_len < kImageProbeSize)"),
                               update.indexOf("if (probe_len != kImageProbeSize)"));
assert.match(probeLoop,
  /!set_http_timeout_to_deadline\(client, transfer_started, kFirmwareDeadline\)/,
  "the image-header read must obey the complete firmware-transfer deadline");
assert.match(probeLoop,
  /esp_http_client_read\(client,[\s\S]{0,200}?n <= 0 && http_deadline_reached\(transfer_started, kFirmwareDeadline\)[\s\S]{0,100}?header_timed_out = true/,
  "an image-header read which consumes its remaining timeout must retain timeout diagnostics");
const transferLoop = update.slice(update.indexOf("while (transfer_ok)"),
                                  update.indexOf("const bool complete", update.indexOf("while (transfer_ok)")));
assert.match(transferLoop,
  /!set_http_timeout_to_deadline\(client, transfer_started, kFirmwareDeadline\)[\s\S]{0,180}?OtaTransferFailure::Timeout/,
  "the bulk image read must abort and diagnose expiry of the complete firmware-transfer deadline");
assert.match(transferLoop,
  /esp_http_client_read\(client,[\s\S]{0,180}?n <= 0 && http_deadline_reached\(transfer_started, kFirmwareDeadline\)[\s\S]{0,180}?OtaTransferFailure::Timeout/,
  "a bulk read which consumes its remaining timeout must retain timeout diagnostics");
assert.match(weather, /kDownloadDeadline\s*=\s*pdMS_TO_TICKS\(60000\)/,
  "a trickling weather response must have a bounded operation deadline");
assert.match(weather,
  /while\s*\(out\.size\(\) <= kPayloadMax\)[\s\S]{0,260}?elapsed >= kDownloadDeadline[\s\S]{0,120}?download_timeout/,
  "weather reads must release the shared network-heap lease when their total deadline expires");
assert.match(weather,
  /esp_http_client_read\(client,[\s\S]{0,180}?n <= 0 && xTaskGetTickCount\(\) - download_started >= kDownloadDeadline[\s\S]{0,100}?download_timeout/,
  "a weather read which consumes its remaining timeout must retain timeout diagnostics");

const init = update.indexOf("esp_http_client_init(");
const probeRead = update.indexOf("esp_http_client_read(", init);
const begin = update.indexOf("esp_ota_begin(");
const writeImage = update.indexOf("esp_ota_write(", begin);
const probeWrite = update.indexOf("write_chunk(buffer, probe_len)", writeImage);
const bulkRead = update.indexOf("esp_http_client_read(", probeWrite);
const bulkWrite = update.indexOf("write_chunk(buffer,", bulkRead);
const release = update.lastIndexOf("close_http_client(client)");
const hashSetup = update.indexOf("psa_hash_setup(");
const hashUpdate = update.indexOf("psa_hash_update(", hashSetup);
const hashFinish = update.indexOf("psa_hash_finish(", hashUpdate);
const exactHash = update.indexOf("ota_sha256_matches(", hashFinish);
const verify = update.indexOf("esp_ota_end(");
const select = update.indexOf("esp_ota_set_boot_partition(");
assert.ok(init >= 0 && begin > init && probeRead > begin && writeImage > probeRead &&
          probeWrite > writeImage && bulkRead > probeWrite && bulkWrite > bulkRead,
  "the firmware image must stream from esp_http_client into the inactive OTA partition");
assert.ok(release > bulkWrite && verify > release && select > verify,
  "HTTP/TLS must be closed and cleaned before signature validation, and boot selection must follow it");
assert.ok(hashSetup > probeRead && hashUpdate > hashSetup && hashFinish > release &&
          exactHash > hashFinish && verify > exactHash,
  "the complete downloaded byte stream must match the checked app SHA before signature validation and boot selection");
assert.match(update,
  /fetch_manifest_identity\([\s\S]{0,500}?strcmp\(offer\.version, request\.version\)[\s\S]{0,180}?strcmp\(offer\.app_sha256, request\.app_sha256\)/,
  "the fresh manifest must still match the accepted checked version and SHA before download");
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

const manifestStart = ota.indexOf("bool fetch_manifest_identity_once(");
const manifestEnd = ota.indexOf("bool fetch_manifest_identity(", manifestStart);
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
  /return\s+free_bytes\s*>=\s*requirement\.min_free_bytes\s*&&\s*largest_free_block\s*>=\s*requirement\.min_largest_block_bytes\s*;/,
  "every OTA phase must require both total-free and largest-contiguous thresholds");
assert.match(headroom,
  /OTA_TRANSFER_HEADROOM\s*=\s*\{\s*56\s*\*\s*1024\s*,\s*24\s*\*\s*1024\s*,\s*4\s*\}/,
  "manifest/image TLS needs the measured 56/24 KiB floor for four stable samples");
assert.match(headroom,
  /OTA_VALIDATION_HEADROOM\s*=\s*\{\s*24\s*\*\s*1024\s*,\s*12\s*\*\s*1024\s*,\s*2\s*\}/,
  "post-TLS RSA validation must keep its independent 24/12 KiB floor");
assert.match(headroom, /if\s*\(!ota_headroom_ok\([^)]*\)\)\s*return\s+0/,
  "one low sample must reset the consecutive-headroom evidence");
assert.match(sdkconfig, /^CONFIG_MBEDTLS_DYNAMIC_BUFFER=y$/m,
  "ESP-IDF's handshake-aware dynamic TLS buffers must remain enabled");
assert.match(sdkconfig, /^CONFIG_MBEDTLS_DYNAMIC_FREE_CONFIG_DATA=n$/m,
  "TLS config/key/CA lifetime must not be shortened without reconnect redesign");
assert.equal(occurrences(update, "wait_for_ota_headroom("), 3,
  "the install path needs one TLS gate and a separate RSA gate before both IDF validation passes");
assert.match(ota,
  /wait_for_ota_headroom\(\s*"manifest"\s*,\s*OTA_TRANSFER_HEADROOM\s*,\s*kTransferHeadroomMaxAttempts/,
  "every manifest client must pass the TLS headroom rule before it allocates");
const firstHeadroom = update.indexOf("wait_for_ota_headroom(");
const secondHeadroom = update.indexOf("wait_for_ota_headroom(", firstHeadroom + 1);
const thirdHeadroom = update.indexOf("wait_for_ota_headroom(", secondHeadroom + 1);
assert.ok(firstHeadroom < init && secondHeadroom > release && secondHeadroom < verify &&
          thirdHeadroom > verify && thirdHeadroom < select,
  "headroom gates must protect transfer, esp_ota_end validation and boot-selection revalidation");
assert.match(update.slice(firstHeadroom, init), /OTA_TRANSFER_HEADROOM/,
  "the pre-download gate must use the TLS budget");
assert.match(update.slice(secondHeadroom, verify), /OTA_VALIDATION_HEADROOM/,
  "the post-cleanup esp_ota_end gate must use the RSA-validation budget");
assert.match(update.slice(thirdHeadroom, select), /OTA_VALIDATION_HEADROOM/,
  "the boot-selection revalidation gate must use the RSA-validation budget");
const sampleStart = ota.indexOf("OtaHeapSample ota_heap_sample(");
const sampleEnd = ota.indexOf("bool wait_for_ota_headroom(", sampleStart);
assert.ok(sampleStart >= 0 && sampleEnd > sampleStart,
  "the device headroom sampler must remain identifiable");
const sample = ota.slice(sampleStart, sampleEnd);
assert.match(sample, /heap_caps_get_free_size\([^)]*MALLOC_CAP_INTERNAL[^)]*\)/,
  "the total-free verifier budget must sample internal 8-bit heap, not PSRAM/default aggregate");
assert.match(sample, /heap_largest_internal_block\(\)/,
  "the device gate must sample internal free heap and the shared internal largest-block metric");

// Bounded retry is deliberate: short-lived allocator churn may clear, but OTA must return control
// instead of waiting forever. Transfer gets 15 seconds; validation gets five seconds.
assert.match(ota, /kHeadroomRetryDelay\s*=\s*pdMS_TO_TICKS\(250\)/,
  "headroom retries must use the bounded 250 ms sampling cadence");
assert.match(ota, /kTransferHeadroomMaxAttempts\s*=\s*60/,
  "TLS headroom retries must stop after about fifteen seconds");
assert.match(ota, /kValidationHeadroomMaxAttempts\s*=\s*20/,
  "validation headroom retries must stop after about five seconds");
assert.match(ota,
  /for\s*\(\s*unsigned\s+attempt\s*=\s*0\s*;\s*attempt\s*<\s*max_attempts\s*;\s*\+\+attempt\s*\)/,
  "the retry loop must be bounded by its phase-specific attempt budget");
const memoryMessages = [...ota.matchAll(/"(Not enough memory[^"\n]*)"/g)]
  .map((match) => match[1]);
assert.ok(memoryMessages.length >= 4,
  "manifest, transfer, download allocation and validation gates need explicit memory diagnoses");
assert.ok(memoryMessages.every((message) => message.includes("retry after reboot")),
  "every OTA-memory refusal must be explicitly retryable and actionable");
assert.match(ota,
  /retryable_allocator_failure\s*=\s*e\s*==\s*ESP_ERR_NO_MEM[\s\S]{0,180}?ESP_ERR_MBEDTLS_SSL_SETUP_FAILED[\s\S]{0,180}?err\s*=\s*retryable_allocator_failure[\s\S]{0,160}?Not enough memory for update TLS/,
  "manifest TLS allocator failure must remain distinct from server reachability after its retry");
assert.match(ota,
  /const bool allocator_failure\s*=[\s\S]{0,180}?ESP_ERR_MBEDTLS_SSL_SETUP_FAILED[\s\S]{0,220}?set_state\("error",\s*allocator_failure[\s\S]{0,160}?Not enough memory for update TLS/,
  "firmware TLS allocator failure must remain distinct from server reachability");
assert.match(update,
  /ESP_ERR_OTA_ROLLBACK_INVALID_STATE[\s\S]{0,140}?Firmware health check is still running — retry in a moment/,
  "a second OTA during rollback probation must report the real retryable state");

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
const taskEnd = ota.indexOf("uint32_t next_generation(", taskStart);
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
  /bool\s+mqtt_transport_network_quiesced\(\)[\s\S]{0,180}?!s_client_running\.load\(std::memory_order_acquire\)[\s\S]{0,120}?s_transport_paused\.load\(std::memory_order_acquire\)/,
  "a stopped or explicitly paused esp-mqtt transport must have a lock-free acknowledgement");
assert.match(mqtt,
  /case MQTT_EVENT_BEFORE_CONNECT:[\s\S]{0,120}?mqtt_transport_before_connect\(\)/,
  "every asynchronous esp-mqtt connection attempt must enter the shared heap handshake");
const beforeConnectStart = mqtt.indexOf("static void mqtt_transport_before_connect(");
const beforeConnectEnd = mqtt.indexOf("static void on_mqtt(", beforeConnectStart);
const beforeConnect = mqtt.slice(beforeConnectStart, beforeConnectEnd);
assert.ok(beforeConnectStart >= 0 && beforeConnectEnd > beforeConnectStart,
  "the synchronous BEFORE_CONNECT callback must remain identifiable");
assert.match(beforeConnect,
  /s_transport_connecting\.store\(true,\s*std::memory_order_release\)/,
  "BEFORE_CONNECT must publish that esp-mqtt transport allocation is active");
assert.doesNotMatch(beforeConnect, /vTaskDelay|for\s*\(|while\s*\(/,
  "BEFORE_CONNECT holds MQTT_API_LOCK and must never wait against client_stop");
const mqttTaskStart = mqtt.indexOf("static void mqtt_task(");
const mqttTaskEnd = mqtt.indexOf("static bool build_client(", mqttTaskStart);
assert.ok(mqttTaskStart >= 0 && mqttTaskEnd > mqttTaskStart,
  "the MQTT publish task must remain identifiable");
const mqttTask = mqtt.slice(mqttTaskStart, mqttTaskEnd);
assert.match(mqttTask,
  /ota_quiesce_step\(network_quiesce, network_busy\)[\s\S]{0,1800}?s_publish_network_quiesced\.store\(true,\s*std::memory_order_release\)[\s\S]{0,200}?continue;/,
  "the held MQTT path must acknowledge that its allocation-rich cycle has ended");
assert.match(mqttTask,
  /s_transport_pause_requested\.load\(std::memory_order_acquire\)[\s\S]{0,220}?esp_mqtt_client_stop\(s_client\)[\s\S]{0,260}?s_client_running\.store\(false,\s*std::memory_order_release\)[\s\S]{0,260}?s_transport_paused\.store\(true,\s*std::memory_order_release\)/,
  "the owning MQTT task must stop and acknowledge esp-mqtt before a competing TLS session starts");
const resumeAt = mqttTask.indexOf("s_transport_paused.load(std::memory_order_acquire)");
const tlsResumeAt = mqttTask.indexOf("mqtt_transport_tls_configured()", resumeAt);
const freeResumeAt = mqttTask.indexOf("free_internal < kMqttTlsResumeMinFree", tlsResumeAt);
const largestResumeAt = mqttTask.indexOf("largest < kMqttTlsResumeMinLargest", freeResumeAt);
const stableResumeAt = mqttTask.indexOf("++transport_resume_stable < kMqttTlsResumeStableSamples",
                                       largestResumeAt);
const startResumeAt = mqttTask.indexOf("start_client_transport()", stableResumeAt);
const backoffResumeAt = mqttTask.indexOf(
  "transport_resume_wait_s = transport_resume_backoff_s", startResumeAt);
const runningResumeAt = mqttTask.indexOf(
  "s_client_running.store(true, std::memory_order_release)", startResumeAt);
assert.ok(resumeAt >= 0 && tlsResumeAt > resumeAt && freeResumeAt > tlsResumeAt &&
          largestResumeAt > freeResumeAt && stableResumeAt > largestResumeAt &&
          startResumeAt > stableResumeAt && backoffResumeAt > startResumeAt &&
          runningResumeAt > backoffResumeAt,
  "MQTTS resume must pass stable free/largest admission and failed starts must back off before the client is marked running");
assert.match(mqtt,
  /kMqttTlsResumeMinFree\s*=\s*56 \* 1024[\s\S]{0,120}?kMqttTlsResumeMinLargest\s*=\s*24 \* 1024[\s\S]{0,120}?kMqttTlsResumeStableSamples\s*=\s*4/,
  "MQTTS resume must use the same measured stable TLS floor as OTA/Weather");
assert.match(mqttTask,
  /transport_resume_backoff_s < kMqttResumeBackoffMaxS \/ 2[\s\S]{0,180}?kMqttResumeBackoffMaxS/,
  "direct esp-mqtt restart failures must have a bounded exponential retry interval");
assert.match(mqtt,
  /struct\s+MqttStartupActivity[\s\S]{0,800}?s_publish_network_quiesced\.store\(false,\s*std::memory_order_release\)[\s\S]{0,300}?if\s*\(!competing_tls_active\(\)\)\s*return;[\s\S]{0,200}?s_publish_network_quiesced\.store\(true,\s*std::memory_order_release\)/,
  "MQTT startup must claim/recheck and yield to an OTA that began before mqtt_ha_start");
assert.match(mqtt,
  /esp_mqtt_client_stop\(s_client\)[\s\S]{0,600}?s_transport_connecting\.store\(false,\s*std::memory_order_release\)[\s\S]{0,600}?esp_mqtt_client_destroy\(s_client\)/,
  "MQTT promotion must clear BEFORE_CONNECT state because client_stop emits no disconnect event");

// The live plant also runs HomeHub and Syslog. Both used to allocate after the OTA flag rose:
// HomeHub copied the string-owning Config and periodically reserved a fresh values vector; every
// OTA diagnostic woke Syslog into another Config/DNS/socket cycle. Their OTA branches must happen
// before those allocations and must yield rather than spin.
const modbusTaskStart = modbus.indexOf("static void mb_task(");
const modbusTaskEnd = modbus.indexOf("static void mb_task_start_if_enabled()", modbusTaskStart);
assert.ok(modbusTaskStart >= 0 && modbusTaskEnd > modbusTaskStart,
  "the HomeHub poll task must remain identifiable");
const modbusTask = modbus.slice(modbusTaskStart, modbusTaskEnd);
const modbusOtaHold = modbusTask.indexOf("ota_download_active()");
const modbusWeatherHold = modbusTask.indexOf("weather_fetch_active()", modbusOtaHold);
const modbusClaim = modbusTask.indexOf("MbNetworkActivity network_activity", modbusWeatherHold);
const modbusRecheck = modbusTask.indexOf("ota_download_active()", modbusClaim);
const modbusConfig = modbusTask.indexOf("config_modbus_host(config())");
assert.ok(modbusOtaHold >= 0 && modbusWeatherHold > modbusOtaHold &&
          modbusClaim > modbusWeatherHold && modbusRecheck > modbusClaim &&
          modbusConfig > modbusRecheck,
  "HomeHub must claim/recheck and stand aside before its Config copy and model-sized cycle allocation");
assert.match(modbusTask.slice(modbusOtaHold, modbusConfig),
  /vTaskDelay\([\s\S]*?continue;/,
  "the HomeHub network hold must yield at its ordinary cadence");
assert.match(modbus,
  /struct\s+MbNetworkActivity[\s\S]{0,220}?s_network_quiesced\.store\(false,\s*std::memory_order_release\)[\s\S]{0,220}?s_network_quiesced\.store\(true,\s*std::memory_order_release\)/,
  "HomeHub cycle ownership must withdraw and restore its acknowledgement by RAII");
assert.match(modbus,
  /bool\s+mb_network_quiesced\(\)[\s\S]{0,120}?s_network_quiesced\.load\(std::memory_order_acquire\)/,
  "HomeHub must expose an allocation-free cycle acknowledgement");

const syslogLoopAnchor = syslog.indexOf("const TickType_t check_interval");
const syslogLoopStart = syslog.indexOf("while (true)", syslogLoopAnchor);
const syslogConfig = syslog.indexOf("const Config& c = config()", syslogLoopStart);
assert.ok(syslogLoopAnchor >= 0 && syslogLoopStart > syslogLoopAnchor &&
          syslogConfig > syslogLoopStart,
  "the allocating Syslog loop must remain identifiable");
const syslogOtaHold = syslog.indexOf("ota_download_active()", syslogLoopStart);
const syslogWeatherHold = syslog.indexOf("weather_fetch_active()", syslogOtaHold);
const syslogClaim = syslog.indexOf("SyslogNetworkActivity network_activity", syslogWeatherHold);
const syslogRecheck = syslog.indexOf("ota_download_active()", syslogClaim);
assert.ok(syslogOtaHold >= 0 && syslogWeatherHold > syslogOtaHold &&
          syslogClaim > syslogWeatherHold && syslogRecheck > syslogClaim &&
          syslogRecheck < syslogConfig,
  "Syslog must claim/recheck and stand aside before Config, DNS, ping and socket allocation");
assert.match(syslog.slice(syslogOtaHold, syslogConfig), /vTaskDelay\([\s\S]*?continue;/,
  "the Syslog OTA hold must yield without draining the diagnostic queue");
assert.match(syslog,
  /struct\s+SyslogNetworkActivity[\s\S]{0,220}?s_network_quiesced\.store\(false,\s*std::memory_order_release\)[\s\S]{0,300}?s_network_quiesced\.store\(true,\s*std::memory_order_release\)/,
  "Syslog cycle ownership must withdraw and restore its acknowledgement by RAII");
assert.match(syslog,
  /bool\s+syslog_network_quiesced\(\)[\s\S]{0,120}?s_network_quiesced\.load\(std::memory_order_acquire\)/,
  "Syslog must expose an allocation-free cycle acknowledgement");
assert.match(weather,
  /!mb_network_quiesced\(\)[\s\S]{0,100}?!syslog_network_quiesced\(\)[\s\S]{0,500}?modbus_quiesce_failed\s*=\s*!mb_network_quiesced\(\)[\s\S]{0,100}?syslog_quiesce_failed\s*=\s*!syslog_network_quiesced\(\)/,
  "Weather TLS must wait for HomeHub and Syslog acknowledgements too");

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
const mqttTransportBarrierCall = task.indexOf("wait_for_mqtt_transport_quiesce()", mqttBarrierCall);
const modbusBarrierCall = task.indexOf("wait_for_modbus_quiesce()", mqttTransportBarrierCall);
const syslogBarrierCall = task.indexOf("wait_for_syslog_quiesce()", modbusBarrierCall);
const weatherBarrierCall = task.indexOf("wait_for_weather_quiesce()", syslogBarrierCall);
const updateCall = task.indexOf("run_update(");
assert.ok(pollBarrierCall >= 0 && mqttBarrierCall > pollBarrierCall &&
          mqttTransportBarrierCall > mqttBarrierCall && modbusBarrierCall > mqttTransportBarrierCall &&
          syslogBarrierCall > modbusBarrierCall &&
          weatherBarrierCall > syslogBarrierCall && updateCall > weatherBarrierCall,
  "OTA must receive poll, MQTT publisher/transport, HomeHub, Syslog and weather acknowledgements before entering the install path");
assert.match(ota,
  /struct\s+OtaNetworkFlag[\s\S]{0,260}?mqtt_transport_pause_for_network_heap\(\)[\s\S]{0,260}?mqtt_transport_resume_after_network_heap\(\)[\s\S]{0,120}?s_network_active\.store\(false/,
  "the OTA network lease must pause esp-mqtt and request resume before releasing its own flag");
assert.match(weather,
  /struct\s+NetworkActivity[\s\S]{0,260}?mqtt_transport_pause_for_network_heap\(\)[\s\S]{0,260}?mqtt_transport_resume_after_network_heap\(\)[\s\S]{0,120}?s_network_active\.store\(false/,
  "the Weather network lease must share the same esp-mqtt transport pause lifecycle");

// The model-sized /values snapshot and the allocation-rich /status snapshot collided with the
// fresh-boot OTA/Weather TLS windows on the 129-row plant. OTA is different from the short weather
// fetch: status and values fail fast before their snapshots, while compact OTA status and the static
// diagnostic ring remain observable.
const valuesSendStart = httpStatus.indexOf("esp_err_t http_send_values_json(");
const valuesSendEnd = httpStatus.indexOf("static esp_err_t h_values(", valuesSendStart);
assert.ok(valuesSendStart >= 0 && valuesSendEnd > valuesSendStart,
  "the shared /values + MCP sender must remain identifiable");
const valuesSend = httpStatus.slice(valuesSendStart, valuesSendEnd);
const valuesOtaGate = valuesSend.indexOf("if (ota_download_active())");
const valuesWait = valuesSend.indexOf("wait_for_values_tls_owner()");
const valuesSnapshot = valuesSend.indexOf("take_values_snapshot()", valuesWait);
assert.ok(valuesOtaGate >= 0 && valuesWait > valuesOtaGate && valuesSnapshot > valuesWait,
  "/values must refuse OTA and finish its weather wait before allocating the model-sized snapshot");
assert.match(valuesSend,
  /if\s*\(ota_download_active\(\)\)\s*return network_tls_busy\(req\);[\s\S]{0,160}?if\s*\(!wait_for_values_tls_owner\(\)\)\s*return network_tls_busy\(req\);/,
  "a timed-out TLS-owner wait must fail closed before the values snapshot allocation");
assert.equal(occurrences(httpStatus, "wait_for_values_tls_owner()"), 2,
  "only the wait helper and the shared values sender may use the values-only gate");
assert.match(httpStatus,
  /network_tls_busy\(httpd_req_t\* req\)[\s\S]*?503 Service Unavailable[\s\S]*?text\/plain[\s\S]*?network operation in progress/,
  "the bounded refusal must stay a small explicit pre-response busy-503");
assert.match(httpStatus,
  /http_values_wait_decision\(\s*false,\s*weather_fetch_active\(\)/,
  "the bounded values wait is only for short weather TLS after OTA received its fast refusal");
assert.match(httpStatus, /kValuesTlsWait\s*=\s*pdMS_TO_TICKS\(4000\)/,
  "the values wait must remain below the five-second live-gate request timeout");
assert.match(httpStatus, /kValuesTlsRetry\s*=\s*pdMS_TO_TICKS\(250\)/,
  "the values wait must yield in bounded 250-ms steps");
const statusStart = httpStatus.indexOf("static esp_err_t h_status(");
const statusEnd = httpStatus.indexOf("struct ValuesSnapshot", statusStart);
assert.ok(statusStart >= 0 && statusEnd > statusStart, "/status must remain identifiable");
const statusHandler = httpStatus.slice(statusStart, statusEnd);
assert.match(statusHandler,
  /if\s*\(ota_download_active\(\)\)\s*return network_tls_busy\(req\);[\s\S]{0,700}?return http_send_status_json\(req, \{\}, \{\}, redact\);/,
  "/status must refuse before entering the streamed snapshot sender while OTA owns TLS");
assert.ok(!statusHandler.includes("wait_for_values_tls_owner"),
  "/status must fail fast rather than blocking the sole HTTP worker");
const activeModelsStart = httpStatus.indexOf("static esp_err_t h_active_model_values(");
const activeModelsEnd = httpStatus.indexOf("static esp_err_t h_models(", activeModelsStart);
const activeModels = httpStatus.slice(activeModelsStart, activeModelsEnd);
assert.ok(activeModelsStart >= 0 && activeModelsEnd > activeModelsStart,
  "the allocation-rich active model catalog must remain identifiable");
assert.match(activeModels,
  /if\s*\(ota_download_active\(\)\)\s*return network_tls_busy\(req\);[\s\S]{0,220}?const Config c = config\(\)/,
  "the active model catalog must refuse OTA before copying Config or building its response");
const historyStart = httpStatus.indexOf("static esp_err_t h_history(");
const historyEnd = httpStatus.indexOf("static esp_err_t h_diag(", historyStart);
const historyHandler = httpStatus.slice(historyStart, historyEnd);
assert.ok(historyStart >= 0 && historyEnd > historyStart, "/history must remain identifiable");
assert.match(historyHandler,
  /if\s*\(ota_download_active\(\)\)\s*return network_tls_busy\(req\);[\s\S]{0,180}?char q\[/,
  "/history must refuse OTA before its growing string and label temporaries");
const diagStart = httpStatus.indexOf("static esp_err_t h_diag(");
const diagEnd = httpStatus.indexOf("static esp_err_t h_diag_clear(", diagStart);
const diagHandler = httpStatus.slice(diagStart, diagEnd);
assert.ok(diagStart >= 0 && diagEnd > diagStart, "/diag must remain identifiable");
assert.match(diagHandler,
  /if\s*\(redact\s*&&\s*ota_download_active\(\)\)\s*return network_tls_busy\(req\);[\s\S]{0,1200}?chunk\.reserve\(1280\)/,
  "redacted /diag must refuse OTA before its growable chunk while plain static-ring diagnostics remain available");
const scanStart = httpStatus.indexOf("static esp_err_t h_scan(");
const scanEnd = httpStatus.indexOf("void http_register_status(", scanStart);
const scanHandler = httpStatus.slice(scanStart, scanEnd);
assert.ok(scanStart >= 0 && scanEnd > scanStart, "/scan must remain identifiable");
assert.match(scanHandler,
  /if\s*\(ota_download_active\(\)\)\s*return network_tls_busy\(req\);[\s\S]{0,180}?wifi_scan\(/,
  "/scan must refuse OTA before Wi-Fi scanning and network-list allocation");
const mcpPostStart = mcp.indexOf("static esp_err_t mcp_post(");
const mcpStatusSend = mcp.indexOf(
  "return http_send_status_json(req, response, suffix, false);", mcpPostStart);
const mcpOtaGate = mcp.indexOf("if (ota_download_active())", mcpPostStart);
const mcpBody = mcp.indexOf("char body[1024]", mcpPostStart);
assert.ok(mcpPostStart >= 0 && mcpOtaGate > mcpPostStart && mcpBody > mcpOtaGate &&
          mcpStatusSend > mcpBody,
  "MCP must refuse OTA before parsing or entering its streamed get_status snapshot");
assert.match(mcp.slice(mcpOtaGate, mcpBody),
  /503 Service Unavailable[\s\S]{0,150}?text\/plain[\s\S]{0,150}?httpd_resp_sendstr/,
  "MCP's OTA refusal must remain allocation-free and explicit");

console.log("OTA heap: dynamic TLS buffers, phase-specific stable headroom, signed validation, " +
            "poll/MQTT/Modbus/Syslog/HTTP quiesce and retryable diagnostics are pinned");
