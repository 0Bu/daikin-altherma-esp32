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
const httpClientDiag = code("main/http_client_diag.cpp");
const httpDeadline = code("main/http_deadline.cpp");
const httpDeadlineHeader = code("main/http_deadline.hpp");
const httpDeadlineLogic = code("main/logic/http_deadline.hpp");
const manifestLogic = code("main/logic/ota_manifest.hpp");
const appMain = code("main/main.cpp");
// Keep this source verbatim: it contains the legitimate captive-portal URI string "/*", which a
// regex comment stripper would mistake for an unterminated block comment and erase most handlers.
const httpStatus = read("main/http_status.cpp");
const headroom = code("main/logic/ota_headroom.hpp");
const quiesceLogic = code("main/logic/ota_quiesce.hpp");
const transport = code("main/logic/ota_transport.hpp");
const fixedText = code("main/logic/fixed_text.hpp");
const hilFeed = code("main/logic/ota_hil_feed.hpp");
const stackWatch = code("main/stack_watch.hpp");
const sdkconfig = read("sdkconfig.defaults");
const mainCmake = code("main/CMakeLists.txt");
const stackBudgets = JSON.parse(read("tools/stack/budgets.json"));
const manifestProvenance = code("scripts/check-manifest-provenance.py");
const securityDocs = read("docs/SECURITY.md");
const featureDocs = read("docs/FEATURES.md");
const healthGateHeaderDocs = read("main/logic/health_gate.hpp");

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
const startUpdateTail = ota.slice(startUpdateAt);
const startUpdateEndMatch = startUpdateTail.match(/\n}\n\n}\s*\/\/ namespace/);
const startUpdateEnd = startUpdateEndMatch ? startUpdateAt + startUpdateEndMatch.index : -1;
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
  /struct OtaTaskArgs[\s\S]{0,300}?uint32_t\s+generation[\s\S]{0,500}?OtaOfferBinding\s+offer\{\}[\s\S]{0,180}?static_assert\(sizeof\(OtaTaskArgs\)\s*<=\s*656/,
  "the asynchronous task identity must use one size-ratcheted fixed offer slot");
assert.match(hilFeed,
  /struct OtaOfferBinding[\s\S]{0,300}?std::array<char,\s*8>\s+channel[\s\S]{0,100}?std::array<char,\s*32>\s+version[\s\S]{0,100}?std::array<char,\s*65>\s+app_sha256[\s\S]{0,100}?OtaFeedUrls\s+feed/,
  "the task offer must keep channel/version/SHA/feed in fixed-capacity storage");
assert.match(ota,
  /uint32_t\s+start_locked[\s\S]{0,300}?s_task_args\s*=\s*request;[\s\S]{0,500}?xTaskCreate\(ota_task/,
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
for (const field of ["state", "message", "available", "available_channel", "current", "channel",
  "image_state"]) {
  assert.match(otaHeader, new RegExp(`FixedText<\\d+>\\s+${field}`),
    `/ota/status ${field} must remain fixed-capacity under TLS pressure`);
}
assert.match(hilFeed, /OTA_FEED_URL_MAX\s*=\s*255/,
  "transient HIL feed URLs must have an explicit fixed maximum");
assert.match(hilFeed, /OTA_FEED_URL_CAPACITY\s*=\s*OTA_FEED_URL_MAX\s*\+\s*1/,
  "transient HIL feed URL storage must include one bounded terminator byte");
assert.match(otaHeader, /OtaStatus ota_status\(OtaFeedUrls\* effective_feed\s*=\s*nullptr\)/,
  "the compact status API must copy its fixed effective-feed pair in the same snapshot");
assert.match(httpOta,
  /OtaFeedUrls\s+effective_feed\{\}[\s\S]{0,100}?ota_status\(&effective_feed\)[\s\S]{0,1800}?effective_feed\.manifest\.data\(\)[\s\S]{0,300}?effective_feed\.firmware_base\.data\(\)/,
  "compact OTA JSON must use the fixed effective-feed snapshot without string allocation");
assert.match(fixedText, /class\s+FixedBuffer[\s\S]{0,900}?overflowed_\s*=\s*true/,
  "the OTA JSON buffer must fail closed on overflow instead of reallocating or truncating");
assert.match(httpOta,
  /FixedBuffer<4096>\s+j[\s\S]{0,2600}?json_append_quoted[\s\S]{0,2600}?if\s*\(!j\.ok\(\)\)/,
  "compact OTA status must use bounded allocation-free JSON with explicit overflow handling");
assert.doesNotMatch(httpOta, /std::to_string|json_quote|std::string\s+j/,
  "compact OTA status must not allocate response strings while TLS owns the heap");
assert.match(config,
  /OtaChannel\s+config_ota_channel\(\)[\s\S]{0,120}?Lock lk\(g_mtx\)[\s\S]{0,120}?return g_cfg\.ota_channel/,
  "OTA status must read one config enum without copying the string-owning Config");
assert.match(ota,
  /OtaStatus\s+ota_status\(OtaFeedUrls\* effective_feed\)[\s\S]{0,700}?config_ota_channel\(\)/,
  "the live OTA status snapshot must use the allocation-free channel accessor");
assert.match(otaHeader,
  /uint32_t\s+heap_min_free_bytes[\s\S]{0,100}?uint32_t\s+heap_min_largest_block_bytes[\s\S]{0,240}?uint32_t\s+ota_stack_min_free_bytes/,
  "operation-local OTA heap minima and OTA stack watermark must remain fixed-width status fields");
assert.match(otaHeader,
  /bool\s+rollback_pending_known\s*=\s*false[\s\S]{0,100}?bool\s+rollback_pending\s*=\s*false/,
  "rollback state must retain an explicit unknown state instead of inventing false");
assert.match(ota,
  /rollback_pending_known\s*=\s*image_state\s*!=\s*OtaRuntimeImageState::Unknown[\s\S]{0,160}?rollback_pending\s*=\s*image_state\s*==\s*OtaRuntimeImageState::PendingVerify/,
  "the boot-latched image-state observation must drive both tri-state fields");
const healthGateAt = ota.indexOf("static void health_gate_task(void*)");
const healthGateEnd = ota.indexOf("void ota_health_gate_arm()", healthGateAt);
assert.ok(healthGateAt >= 0 && healthGateEnd > healthGateAt,
  "the rollback-critical health-gate task must remain independently identifiable");
const healthGate = ota.slice(healthGateAt, healthGateEnd);
const imageStateRead = healthGate.indexOf("esp_ota_get_state_partition(running, &st)");
const unknownState = healthGate.indexOf("OtaRuntimeImageState::Unknown", imageStateRead);
const nonPendingBranch = healthGate.indexOf("if (st != ESP_OTA_IMG_PENDING_VERIFY)", unknownState);
const validMapping = healthGate.indexOf(
  "st == ESP_OTA_IMG_VALID ? OtaRuntimeImageState::Valid : OtaRuntimeImageState::Unarmed",
  nonPendingBranch);
const pendingState = healthGate.indexOf("OtaRuntimeImageState::PendingVerify", validMapping);
const markValid = healthGate.indexOf("esp_ota_mark_app_valid_cancel_rollback()", pendingState);
const successfulMark = healthGate.indexOf("if (e == ESP_OK)", markValid);
const committedValid = healthGate.indexOf("OtaRuntimeImageState::Valid", successfulMark);
assert.ok(imageStateRead >= 0 && unknownState > imageStateRead &&
  nonPendingBranch > unknownState && validMapping > nonPendingBranch &&
  pendingState > validMapping && markValid > pendingState && successfulMark > markValid &&
  committedValid > successfulMark,
"ESP-IDF image-state evidence must flow Unknown/Pending/Valid/Unarmed without optimistic ordering");
const readFailureEnd = healthGate.indexOf("if (st != ESP_OTA_IMG_PENDING_VERIFY)", unknownState);
assert.match(healthGate.slice(imageStateRead, readFailureEnd),
  /!= ESP_OK\)[\s\S]*?OtaRuntimeImageState::Unknown[\s\S]*?vTaskDelete\(nullptr\)[\s\S]*?return;/,
  "an unreadable otadata state must latch Unknown and stop rather than inventing rollback safety");
assert.match(healthGate.slice(nonPendingBranch, pendingState),
  /st == ESP_OTA_IMG_VALID \? OtaRuntimeImageState::Valid : OtaRuntimeImageState::Unarmed[\s\S]*?s_runtime_image_state\.store[\s\S]*?vTaskDelete\([\s\S]*?return;/,
  "only IDF VALID maps to Valid; every other non-pending state must map to Unarmed");
const markBranchEnd = healthGate.indexOf("break;", successfulMark);
assert.match(healthGate.slice(markValid, markBranchEnd),
  /esp_ota_mark_app_valid_cancel_rollback\(\)[\s\S]*?if \(e == ESP_OK\) \{[\s\S]*?OtaRuntimeImageState::Valid[\s\S]*?\} else \{[\s\S]*?marking the image valid failed/,
  "a Pending image may become Valid only after ESP-IDF confirms the rollback commit");
for (const [name, document] of [
  ["OTA header", read("main/ota_update.hpp")],
  ["health-gate header", healthGateHeaderDocs],
  ["security documentation", securityDocs],
  ["feature documentation", featureDocs],
]) {
  assert.doesNotMatch(document, /USB[\s\S]{0,180}(?:boots?|is)\s+`?UNDEFINED/i,
    `${name} must not claim that blank USB otadata produced a successful UNDEFINED state read`);
}
assert.match(securityDocs, /esp_ota_get_state_partition\(\)/,
  "security docs must name the authoritative IDF state API");
assert.match(securityDocs, /returns `ESP_ERR_NOT_FOUND` \(not `PENDING_VERIFY`\)/,
  "security docs must preserve the blank/no-record IDF result");
assert.match(securityDocs,
  /`image_state:"unknown"`[\s\S]{0,100}?`rollback_pending:null`/,
  "security docs must preserve the fail-closed blank-otadata Unknown/null contract");
assert.doesNotMatch(ota, /exact signed artifact/,
  "device status identity must not claim a full cryptographic readback of running flash");
const otaTaskStackMatch = ota.match(/constexpr int\s+kTaskStack\s*=\s*(\d+)/);
const otaManifestMaxMatch = ota.match(/constexpr size_t\s+kManifestMax\s*=\s*(\d+)/);
const healthTaskStackMatch = ota.match(/constexpr int\s+kHealthTaskStack\s*=\s*(\d+)/);
const weatherTaskStackMatch = weather.match(/constexpr int\s+kTaskStack\s*=\s*(\d+)/);
assert.ok(otaTaskStackMatch && healthTaskStackMatch,
  "both transient OTA task stack sizes must remain machine-readable");
assert.equal(Number(otaManifestMaxMatch?.[1]), 2048,
  "the complete shared installer manifest must fit the reviewed 2 KiB OTA frame");
assert.match(manifestProvenance,
  /OTA_SOURCE\s*=\s*ROOT\s*\/\s*"main\/ota_update\.cpp"[\s\S]*?OTA_MANIFEST_LIMIT_RE[\s\S]*?kManifestMax[\s\S]*?len\(manifest_bytes\) > manifest_limit/,
  "the publisher must fail closed when its manifest exceeds the firmware frame");
assert.ok(weatherTaskStackMatch,
  "the Weather TLS task stack size must remain machine-readable");
const minimumStackReserve = 1024;
assert.ok(stackBudgets.paths.ota_task_manifest_fetch.max_bytes <=
  Number(otaTaskStackMatch[1]) - minimumStackReserve,
"the complete OTA manifest path ELF ceiling must leave at least 1 KiB on its task stack");
assert.ok(stackBudgets.paths.ota_health_gate.max_bytes <=
  Number(healthTaskStackMatch[1]) - minimumStackReserve,
"the rollback-critical health-gate ELF ceiling must leave at least 1 KiB on its task stack");
for (const pathName of ["weather_task_download", "weather_task_parse"]) {
  assert.ok(stackBudgets.paths[pathName].max_bytes <=
    Number(weatherTaskStackMatch[1]) - minimumStackReserve,
  `${pathName} must leave at least 1 KiB on the Weather task stack`);
}
assert.deepEqual(stackBudgets.paths.weather_task_download.symbols,
  ["weather_task", "weather_fetch", "weather_download"]);
assert.deepEqual(stackBudgets.paths.weather_task_parse.symbols,
  ["weather_task", "weather_fetch", "weather_parse"]);
assert.equal(stackBudgets.paths.weather_task_download.base_bytes, 2048,
  "Weather download must retain its reviewed TLS/IDF/exception allowance");
assert.equal(stackBudgets.paths.weather_task_parse.base_bytes, 2048,
  "Weather parse must retain its reviewed cJSON/exception allowance");
assert.deepEqual(stackBudgets.paths.ota_health_gate.symbols, ["ota_health_task"]);
assert.equal(stackBudgets.paths.ota_health_gate.base_bytes, 2048,
  "the health-gate path must retain its reviewed IDF/logging/exception allowance");
assert.match(stackBudgets.symbols.ota_health_task.pattern, /health_gate_task/,
  "the health-gate budget must fail closed if its production symbol disappears");
assert.match(httpOta,
  /if\s*\(s\.rollback_pending_known\)[\s\S]{0,100}?s\.rollback_pending\s*\?\s*"true"\s*:\s*"false"[\s\S]{0,100}?j\s*\+=\s*"null"/,
  "unknown image state must render rollback_pending as JSON null");
assert.match(httpOta,
  /,\\"heap_min_free_bytes\\":[\s\S]{0,160}?,\\"heap_min_largest_block_bytes\\":[\s\S]{0,240}?,\\"ota_stack_min_free_bytes\\":[\s\S]{0,180}?null/,
  "compact OTA status must expose heap dimensions and null-before-sample OTA stack evidence");
assert.match(stackWatch, /Modbus[\s\S]{0,120}?Weather[\s\S]{0,120}?Ota[\s\S]{0,120}?COUNT/,
  "the shared allocation-free stack watcher must retain Weather and transient OTA minima");
assert.ok(occurrences(weather, "stack_watch_sample(StackWatch::Weather)") >= 2,
  "Weather must sample after the real TLS/HTTP/JSON interval before HIL accepts it");
assert.match(httpStatus,
  /weather_forecast[\s\S]*?task_stack_min_free_bytes[\s\S]*?StackWatch::Weather/,
  "Weather status must expose path-local stack evidence");
assert.match(httpStatus,
  /stack_min_free_bytes[\s\S]*?j \+= ",\\"weather\\":";[\s\S]*?StackWatch::Weather/,
  "always-on status must expose Weather stack evidence to release HIL");
assert.match(ota,
  /OtaHeapSample\s+ota_heap_sample\(\)[\s\S]{0,180}?stack_watch_sample\(StackWatch::Ota\)/,
  "every existing OTA heap checkpoint must also sample the task's retrospective stack watermark");
assert.match(ota,
  /esp_ota_set_boot_partition\(update_partition\)[\s\S]{0,800}?stack_watch_sample\(StackWatch::Ota\)[\s\S]{0,500}?esp_restart\(\)/,
  "the successful install path must sample after the second verifier and before reboot");
const otaStatusAt = ota.indexOf("OtaStatus ota_status(");
const otaStatusEndAt = ota.indexOf("\n}\n\nbool ota_changelog_chunk", otaStatusAt);
const otaStatusBody = ota.slice(otaStatusAt, otaStatusEndAt);
assert.match(otaStatusBody, /stack_watch_min_free_bytes\(StackWatch::Ota\)/,
  "compact OTA status must read the allocation-free boot-retained OTA watermark");
assert.doesNotMatch(otaStatusBody, /uxTaskGetStackHighWaterMark|esp_ota_get_state_partition|esp_partition_read/,
  "the compact status path must neither sample another task nor read image-state flash");
assert.match(ota,
  /ota_heap_operation_reset\(\);[\s\S]{0,160}?OtaNetworkFlag active/,
  "each accepted operation must reset heap telemetry before the network phase");
assert.match(ota,
  /void set_progress\([\s\S]{0,220}?ota_heap_sample\(\);[\s\S]{0,120}?s_status\.progress/,
  "firmware transfer progress must sample heap before publishing each percentage");
assert.match(ota,
  /s_status\.heap_min_free_bytes[\s\S]{0,180}?s_operation_min_free\.load[\s\S]{0,180}?s_status\.heap_min_largest_block_bytes[\s\S]{0,180}?s_operation_min_largest\.load/,
  "OTA status must read both lock-free operation minima");
const defaultFeedAt = hilFeed.indexOf("bool ota_default_feed_urls(");
const defaultFeedEnd = hilFeed.indexOf("\n}\n\ninline bool ota_feed_urls_valid", defaultFeedAt);
assert.ok(defaultFeedAt >= 0 && defaultFeedEnd > defaultFeedAt,
  "the fixed default-feed resolver must remain identifiable");
const defaultFeed = hilFeed.slice(defaultFeedAt, defaultFeedEnd);
assert.doesNotMatch(defaultFeed, /std::string\s|ota_url_join|ota_channel_manifest_url/,
  "default feed resolution must not construct temporary strings");
assert.match(defaultFeed, /ota_fixed_text_append/,
  "default feed resolution must use bounded fixed-buffer appends");
const startCheckAt = ota.indexOf("uint32_t start_check(");
const startCheckEnd = ota.indexOf("\n}\n\nuint32_t start_update", startCheckAt);
const startCheck = ota.slice(startCheckAt, startCheckEnd);
const busyPreflight = startCheck.indexOf("if (s_busy) return 0");
const checkConfigRead = startCheck.indexOf("config_ota_channel()", busyPreflight);
const defaultResolution = startCheck.indexOf("ota_default_feed_urls(", checkConfigRead);
const checkAcceptanceLock = startCheck.lastIndexOf("Lock lk(s_mtx)");
assert.ok(busyPreflight >= 0 && checkConfigRead > busyPreflight &&
  defaultResolution > checkConfigRead && checkAcceptanceLock > defaultResolution,
  "a busy check must refuse before config/default-feed derivation, then close the acceptance race");
const otaStatusStart = otaHeader.indexOf("struct OtaStatus {");
const otaStatusEnd = otaHeader.indexOf("\n};", otaStatusStart);
assert.ok(otaStatusStart >= 0 && otaStatusEnd > otaStatusStart,
  "the OTA status structure must remain identifiable");
assert.doesNotMatch(otaHeader.slice(otaStatusStart, otaStatusEnd), /changelog/,
  "optional release notes must stay out of the frequently copied /ota/status snapshot");
assert.match(ota, /constexpr\s+size_t\s+kChangelogDocumentMax\s*=\s*1025/,
  "the transient remote-document slot must stay at most 1025 bytes");
assert.doesNotMatch(ota, /std::array<char,\s*kChangelogDocumentMax>|s_changelog_document|s_changelog_candidate|MALLOC_CAP_SPIRAM/,
  "release notes must reserve no boot-long document buffer, duplicate candidate or PSRAM dependency");
assert.match(httpOta,
  /char\s+chunk\[128\][\s\S]{0,600}?ota_changelog_chunk\([\s\S]{0,300}?httpd_resp_send_chunk\(req,\s*chunk,\s*copied\)/,
  "GET /ota/changelog must stream retained notes in fixed chunks");
assert.match(httpOta,
  /struct\s+ChangelogLeaseRelease[\s\S]{0,220}?~ChangelogLeaseRelease\(\)\s*\{\s*ota_changelog_release\(generation\);\s*\}/,
  "every accepted changelog response path must consume its one-shot retained-text lease");

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

// ESP-IDF v6.0.2 loops inside both fetch_headers() and read(), so changing timeout_ms only between
// public calls is not an absolute bound. One boot-created timer interrupts only the exposed socket;
// the owner task joins that callback before close/cleanup or range-resume fd reuse.
assert.match(mainCmake, /"http_deadline\.cpp"/,
  "the shared socket-deadline implementation must be linked into the firmware");
const deadlineInit = appMain.indexOf("http_deadline_init()");
const firstNetworkStart = appMain.indexOf("net_eth_start()");
assert.ok(deadlineInit >= 0 && firstNetworkStart > deadlineInit,
  "the one HTTP deadline timer must be allocated before networking and TLS pressure");
assert.match(httpDeadlineHeader,
  /class\s+HttpSocketDeadline[\s\S]{0,800}?arm\(esp_http_client_handle_t[\s\S]{0,300}?disarm\(\)\s*noexcept/,
  "OTA and Weather must share one explicit arm/expiry/disarm socket guard");
assert.match(httpDeadlineLogic,
  /now\s*-\s*started[\s\S]{0,180}?elapsed\s*>=\s*duration/,
  "absolute-deadline arithmetic must remain unsigned and tick-wrap safe");
assert.match(httpDeadline,
  /xSemaphoreCreateBinaryStatic[\s\S]{0,400}?xSemaphoreCreateMutexStatic[\s\S]{0,700}?xTaskCreateStatic[\s\S]{0,900}?esp_timer_create/,
  "the guard must use static synchronization, one static watchdog task and one boot-created timer");
assert.match(httpDeadline,
  /static_assert\(std::atomic<int>::is_always_lock_free[\s\S]{0,220}?static_assert\(std::atomic<bool>::is_always_lock_free/,
  "timer-task socket and verdict publication must never hide allocator-backed atomic locks");
assert.match(httpDeadline, /StackType_t\s+watchdog_stack\[kWatchdogStackBytes\]/,
  "the deadline watchdog stack must be static rather than another failure-time heap allocation");
assert.doesNotMatch(httpDeadline, /\bxTaskCreate\s*\(|esp_http_client_cancel_request/,
  "the deadline must not dynamically create a task or mutate esp_http_client from another task");
const watchdogTaskStart = httpDeadline.indexOf("void socket_deadline_watchdog_task(");
const watchdogTaskEnd = httpDeadline.indexOf("\n}\n\nvoid socket_deadline_expired", watchdogTaskStart);
assert.ok(watchdogTaskStart >= 0 && watchdogTaskEnd > watchdogTaskStart,
  "the static socket-deadline watchdog task must remain identifiable");
const watchdogTask = httpDeadline.slice(watchdogTaskStart, watchdogTaskEnd);
const watchdogPrime = watchdogTask.indexOf("sys_thread_sem_get()");
const watchdogPrimeCheck = watchdogTask.indexOf("thread_sem != nullptr", watchdogPrime);
const watchdogInitAck = watchdogTask.indexOf("xSemaphoreGive(s_deadline.init_completion)",
  watchdogPrimeCheck);
const watchdogShutdown = watchdogTask.indexOf("shutdown(socket, SHUT_RDWR)", watchdogInitAck);
const watchdogFailure = watchdogTask.indexOf("shutdown_result != 0", watchdogShutdown);
const watchdogAbort = watchdogTask.indexOf("deadline_fail_closed()", watchdogFailure);
const watchdogAck = watchdogTask.indexOf("xSemaphoreGive(s_deadline.completion)", watchdogAbort);
assert.ok(watchdogPrime >= 0 && watchdogPrimeCheck > watchdogPrime &&
  watchdogInitAck > watchdogPrimeCheck && watchdogShutdown > watchdogInitAck &&
  watchdogFailure > watchdogShutdown && watchdogAbort > watchdogFailure &&
  watchdogAck > watchdogAbort,
  "the static watchdog must require a successful lwIP prime at boot and fail closed on shutdown before ack");
const deadlineCallbackStart = httpDeadline.indexOf("void socket_deadline_expired(");
const deadlineCallbackEnd = httpDeadline.indexOf("}\n\n}", deadlineCallbackStart);
assert.ok(deadlineCallbackStart >= 0 && deadlineCallbackEnd > deadlineCallbackStart,
  "the socket-deadline callback must remain identifiable");
const deadlineCallback = httpDeadline.slice(deadlineCallbackStart, deadlineCallbackEnd);
assert.match(deadlineCallback,
  /fired\.store\(true[\s\S]{0,180}?xTaskNotifyGive\(s_deadline\.watchdog_task\)/,
  "the timer callback may only latch expiry and notify the pre-primed static task");
assert.doesNotMatch(deadlineCallback,
  /esp_http_client_|\bclose\s*\(|\bshutdown\s*\(|esp_timer_stop|owner|xSemaphoreGive/,
  "the timer task must never touch a socket/client, close an fd or acknowledge work it did not do");
assert.match(httpDeadline,
  /bool http_deadline_ready\(\)[\s\S]{0,140}?ready\.load\(std::memory_order_acquire\)/,
  "the boot result must have an allocation-free readiness latch");
assert.match(startCheck,
  /if \(!http_deadline_ready\(\)\) return 0;[\s\S]{0,500}?config_ota_channel\(\)[\s\S]{0,900}?start_locked/,
  "OTA checks must refuse before feed derivation and task creation when the watchdog is unavailable");
assert.match(weather,
  /void weather_forecast_start\(\)[\s\S]{0,500}?!http_deadline_ready\(\)[\s\S]{0,500}?xTaskCreate\(weather_task/,
  "Weather must refuse task creation when its boot-owned deadline watchdog is unavailable");
assert.match(weather,
  /bool download_json\([\s\S]{0,220}?!http_deadline_ready\(\)[\s\S]{0,220}?out\.reserve\(kPayloadMax\)[\s\S]{0,600}?esp_http_client_init/,
  "Weather must recheck readiness before payload and HTTP/TLS allocation");
const deadlineArmStart = httpDeadline.indexOf("esp_err_t HttpSocketDeadline::arm(");
const deadlineDisarmStart = httpDeadline.indexOf("bool HttpSocketDeadline::disarm(");
const deadlineArm = httpDeadline.slice(deadlineArmStart, deadlineDisarmStart);
const deadlineDisarm = httpDeadline.slice(deadlineDisarmStart);
assert.match(deadlineArm,
  /http_deadline_remaining_ticks\(started,\s*now,\s*duration\)[\s\S]{0,700}?esp_http_client_get_socket\(client\)[\s\S]{0,700}?esp_timer_start_once/,
  "arming must bind the public socket to the remainder of the original caller deadline");
assert.match(deadlineArm,
  /while\s*\(xSemaphoreTake\(s_deadline\.completion,\s*0\)\s*==\s*pdTRUE\)/,
  "a stale completion acknowledgement must be drained before fd publication/re-arm");
const stopDeadline = deadlineDisarm.indexOf("esp_timer_stop(s_deadline.timer)");
const joinDeadline = deadlineDisarm.indexOf(
  "xSemaphoreTake(s_deadline.completion, portMAX_DELAY)", stopDeadline);
const clearDeadlineSocket = deadlineDisarm.indexOf("s_deadline.socket.store(-1", joinDeadline);
const clearDeadlineOwner = deadlineDisarm.indexOf("s_deadline.owner = nullptr", clearDeadlineSocket);
assert.ok(stopDeadline >= 0 && joinDeadline > stopDeadline &&
          clearDeadlineSocket > joinDeadline && clearDeadlineOwner > clearDeadlineSocket,
  "disarm must stop or join callback completion before clearing fd/owner for reuse");
assert.match(deadlineDisarm,
  /owner\s*!=\s*this[\s\S]{0,300}?std::abort\(\)[\s\S]{0,900}?stop_err\s*!=\s*ESP_OK[\s\S]{0,300}?std::abort\(\)/,
  "unprovable owner/stop exclusion must abort rather than continue into unsafe fd reuse");

const manifestFetchStart = ota.indexOf("bool fetch_manifest_identity_once(");
const manifestFetchEnd = ota.indexOf("bool fetch_manifest_identity(", manifestFetchStart);
const manifestDeadlineFetch = ota.slice(manifestFetchStart, manifestFetchEnd);
assert.ok(manifestFetchStart >= 0 && manifestFetchEnd > manifestFetchStart,
  "the manifest transfer must remain identifiable");
assert.match(manifestDeadlineFetch,
  /while\s*\(!body_too_big && got < sizeof\(buf\)\)[\s\S]{0,220}?!set_http_timeout_to_deadline\(c, manifest_started, kManifestDeadline\)/,
  "manifest reads must consume the remaining operation deadline rather than only per-read timeouts");
assert.match(manifestDeadlineFetch,
  /socket_deadline\.arm\(c,\s*manifest_started,\s*kManifestDeadline\)[\s\S]{0,700}?esp_http_client_fetch_headers\(c\)[\s\S]{0,220}?socket_deadline\.expired\(\)/,
  "manifest header fetch must be interrupted and classified by the absolute socket guard");
const manifestBodyLoopStart = manifestDeadlineFetch.indexOf(
  "while (!body_too_big && got < sizeof(buf))");
const manifestBodyLoopEnd = manifestDeadlineFetch.indexOf(
  "if (!timed_out && !read_failed && !body_too_big && got == sizeof(buf))",
  manifestBodyLoopStart);
const manifestBodyLoop = manifestDeadlineFetch.slice(manifestBodyLoopStart, manifestBodyLoopEnd);
assert.match(manifestBodyLoop,
  /esp_http_client_read\(c,[\s\S]{0,220}?socket_deadline\.expired\(\)[\s\S]{0,180}?timed_out\s*=\s*true/,
  "a partial body return after manifest socket shutdown must still be classified as timeout");
assert.match(manifestDeadlineFetch,
  /socket_deadline\.disarm\(\)[\s\S]{0,900}?close_http_client\(c,\s*socket_deadline\)/,
  "manifest must join its header/body watchdog before parsing and before client cleanup");
assert.match(manifestDeadlineFetch,
  /esp_http_client_get_content_length\(c\)[\s\S]{0,2500}?esp_http_client_read\(c,\s*&extra,\s*1\)[\s\S]{0,1500}?http_body_complete\([\s\S]{0,180}?esp_http_client_is_complete_data_received\(c\)/,
  "manifest must reject claimed truncation, unknown-length overflow and incomplete HTTP framing");
assert.match(manifestLogic,
  /skip_json_value\([\s\S]{0,420}?MAX_JSON_DEPTH\s*=\s*8[\s\S]{0,1800}?json\[pos\]\s*==\s*','[\s\S]{0,300}?json\[pos\]\s*==\s*'\}'[\s\S]{0,900}?json\[pos\]\s*==\s*'\]'/,
  "unknown manifest values must use a depth-bounded strict JSON grammar");
const identityStart = manifestLogic.search(/bool\s+manifest_identity\s*\(/);
const identityEnd = manifestLogic.indexOf("// Parse the optional sibling changelog", identityStart);
const identity = manifestLogic.slice(identityStart, identityEnd);
const provenanceStart = identity.indexOf("auto parse_provenance");
const rootStart = identity.indexOf("detail::skip_ws(json, len, i);", provenanceStart);
const provenance = identity.slice(provenanceStart, rootStart);
const provenanceComma = provenance.indexOf("json[pos] == ','");
const provenanceClose = provenance.indexOf("json[pos] == '}'", provenanceComma);
const provenanceReject = provenance.indexOf("return false", provenanceClose);
assert.ok(provenanceStart >= 0 && rootStart > provenanceStart && provenanceComma >= 0 &&
  provenanceClose > provenanceComma && provenanceReject > provenanceClose,
  "manifest provenance must require commas, its matching object closer and reject other bytes");
assert.equal(occurrences(provenance, "json[pos] == '}'"), 2,
  "both empty and populated provenance objects must require their matching object closer");
const identityRoot = identity.slice(rootStart);
const rootOpen = identityRoot.indexOf("json[i++] != '{'");
const rootComma = identityRoot.indexOf("json[i] == ','", rootOpen);
const rootClose = identityRoot.indexOf("json[i] == '}'", rootComma);
const rootReject = identityRoot.indexOf("return false", rootClose);
const rootExact = identityRoot.indexOf(
  "return i == len && have_version && have_provenance && have_sha", rootReject);
assert.ok(rootOpen >= 0 && rootComma > rootOpen && rootClose > rootComma &&
  rootReject > rootClose && rootExact > rootReject,
  "manifest identity must require root member commas, its matching closer and exactly one root");
const probeLoop = update.slice(update.indexOf("while (probe_len < kImageProbeSize)"),
                               update.indexOf("if (probe_len != kImageProbeSize)"));
assert.match(probeLoop,
  /!set_http_timeout_to_deadline\(client, transfer_started, kFirmwareDeadline\)/,
  "the image-header read must obey the complete firmware-transfer deadline");
assert.match(probeLoop,
  /esp_http_client_read\(client,[\s\S]{0,220}?socket_deadline\.expired\(\)[\s\S]{0,180}?header_timed_out\s*=\s*true/,
  "a partial image-header return after socket shutdown must retain timeout diagnostics");
const transferLoop = update.slice(update.indexOf("while (transfer_ok)"),
                                  update.indexOf("const bool complete", update.indexOf("while (transfer_ok)")));
assert.match(transferLoop,
  /!set_http_timeout_to_deadline\(client, transfer_started, kFirmwareDeadline\)[\s\S]{0,180}?OtaTransferFailure::Timeout/,
  "the bulk image read must abort and diagnose expiry of the complete firmware-transfer deadline");
assert.match(transferLoop,
  /esp_http_client_read\(client,[\s\S]{0,220}?socket_deadline\.expired\(\)[\s\S]{0,180}?OtaTransferFailure::Timeout/,
  "a partial firmware-body return after socket shutdown must retain timeout diagnostics");
assert.match(weather, /kDownloadDeadline\s*=\s*pdMS_TO_TICKS\(60000\)/,
  "a trickling weather response must have a bounded operation deadline");
assert.match(weather,
  /socket_deadline\.arm\(client,\s*download_started,\s*kDownloadDeadline\)[\s\S]{0,260}?esp_http_client_fetch_headers\(client\)[\s\S]{0,160}?socket_deadline\.expired\(\)/,
  "Weather headers must share the absolute socket watchdog");
assert.match(weather,
  /esp_http_client_read\(client,[\s\S]{0,180}?socket_deadline\.expired\(\)[\s\S]{0,120}?download_timeout/,
  "a partial Weather body return after socket shutdown must retain timeout diagnostics");
assert.match(weather,
  /n\s*==\s*0[\s\S]{0,260}?http_body_complete\([\s\S]{0,180}?esp_http_client_is_complete_data_received\(client\)[\s\S]{0,180}?incomplete_payload[\s\S]{0,180}?ok\s*=\s*!out\.empty\(\)/,
  "Weather must reject premature EOF before parsing a non-empty response prefix as fresh data");
const weatherParseStart = weather.indexOf("bool parse_forecast(");
const weatherParseEnd = weather.indexOf("\n}\n\nbool fetch_forecast", weatherParseStart);
const weatherParse = weather.slice(weatherParseStart, weatherParseEnd);
const cjsonParse = weatherParse.indexOf("cJSON_ParseWithLengthOpts(");
const parseEndCheck = weatherParse.indexOf("json_suffix_is_whitespace(", cjsonParse);
const trailingError = weatherParse.indexOf('error = "json_trailing_data"', parseEndCheck);
assert.ok(cjsonParse >= 0 && parseEndCheck > cjsonParse && trailingError > parseEndCheck,
  "Weather must reject non-whitespace bytes after the parsed JSON root");
assert.match(weatherParse,
  /if \(!parse_end[\s\S]{0,220}?\|\|\s*!json_suffix_is_whitespace\(/,
  "the trailing-root check must participate directly in Weather's rejection condition");
assert.match(weather,
  /~HttpClientCleanup\(\)[\s\S]{0,260}?deadline\.disarm\(\)[\s\S]{0,180}?esp_http_client_close\(handle\)[\s\S]{0,120}?esp_http_client_cleanup\(handle\)/,
  "Weather exception cleanup must join the watchdog before releasing the client/fd");

const init = update.indexOf("esp_http_client_init(");
const probeRead = update.indexOf("esp_http_client_read(", init);
const begin = update.indexOf("esp_ota_begin(");
const writeImage = update.indexOf("esp_ota_write(", begin);
const probeWrite = update.indexOf("write_chunk(buffer, probe_len)", writeImage);
const bulkRead = update.indexOf("esp_http_client_read(", probeWrite);
const bulkWrite = update.indexOf("write_chunk(buffer,", bulkRead);
const release = update.lastIndexOf("close_http_client(client, socket_deadline)");
const completeDecision = update.indexOf("const bool complete =", bulkWrite);
const finalBufferRelease = update.indexOf("heap_caps_free(buffer)", completeDecision);
const finalTransportRelease = update.indexOf(
  "close_http_client(client, socket_deadline)", finalBufferRelease);
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
assert.ok(completeDecision > bulkWrite && finalBufferRelease > completeDecision &&
          finalTransportRelease > finalBufferRelease && finalTransportRelease < hashFinish,
  "the final response decision must release its buffer and TLS client before exact-hash finish");
assert.ok(hashSetup > probeRead && hashUpdate > hashSetup && hashFinish > release &&
          exactHash > hashFinish && verify > exactHash,
  "the complete downloaded byte stream must match the checked app SHA before signature validation and boot selection");
assert.match(update,
  /fetch_manifest_identity\([\s\S]{0,500}?strcmp\(offer\.version, request\.offer\.version\.data\(\)\)[\s\S]{0,180}?strcmp\(offer\.app_sha256, request\.offer\.app_sha256\.data\(\)\)/,
  "the fresh manifest must still match the accepted checked version and SHA before download");
const closeHelperStart = ota.indexOf("void close_http_client(");
const closeHelperEnd = ota.indexOf("esp_err_t open_firmware_stream(", closeHelperStart);
assert.ok(closeHelperStart >= 0 && closeHelperEnd > closeHelperStart,
  "the HTTP/TLS release helper must remain identifiable");
const closeHelper = ota.slice(closeHelperStart, closeHelperEnd);
const closeHelperDisarm = closeHelper.indexOf("deadline.disarm()");
const closeHelperClose = closeHelper.indexOf("esp_http_client_close(");
assert.ok(closeHelperDisarm >= 0 && closeHelperClose > closeHelperDisarm,
  "the owner must stop or join socket shutdown before close can recycle the fd");
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

const changelogStart = ota.indexOf("ChangelogBuffer fetch_changelog(");
const changelogEnd = ota.indexOf("void run_check(", changelogStart);
assert.ok(changelogStart >= 0 && changelogEnd > changelogStart,
  "the optional changelog fetch boundary must remain identifiable");
const changelogFetch = ota.slice(changelogStart, changelogEnd);
assert.match(changelogFetch,
  /char\s+url\[256\][\s\S]{0,180}?ota_manifest_sibling_url\(manifest_url,\s*"changelog\.json",\s*url,\s*sizeof\(url\)\)/,
  "the sibling changelog URL must use bounded storage instead of a second heap string");
const changelogHttps = changelogFetch.indexOf("ota_url_is_absolute_https(url)");
const changelogHeapGate = changelogFetch.indexOf('wait_for_ota_headroom("changelog", OTA_CHANGELOG_HEADROOM');
const changelogInit = changelogFetch.indexOf("esp_http_client_init(");
const changelogDeadline = changelogFetch.indexOf(
  "set_http_timeout_to_deadline(c, changelog_started, kChangelogDeadline", changelogInit);
const changelogArm = changelogFetch.indexOf(
  "socket_deadline.arm(c, changelog_started, kChangelogDeadline)", changelogDeadline);
const changelogHeaders = changelogFetch.indexOf("esp_http_client_fetch_headers(", changelogInit);
const changelogDocument = changelogFetch.indexOf("heap_caps_calloc(1, kChangelogDocumentMax, MALLOC_CAP_8BIT)");
const changelogRead = changelogFetch.indexOf("esp_http_client_read(", changelogDocument);
const changelogDisarm = changelogFetch.indexOf("socket_deadline.disarm()", changelogRead);
const changelogClose = changelogFetch.lastIndexOf("close_http_client(c, socket_deadline)");
const changelogExact = changelogFetch.indexOf(
  "heap_caps_malloc(decoded_len + 1, MALLOC_CAP_8BIT)", changelogClose);
assert.ok(changelogHttps >= 0 && changelogHeapGate > changelogHttps &&
          changelogInit > changelogHeapGate && changelogDeadline > changelogInit &&
          changelogArm > changelogDeadline && changelogHeaders > changelogArm &&
          changelogDocument > changelogHeaders && changelogRead > changelogDocument &&
          changelogDisarm > changelogRead && changelogClose > changelogDisarm &&
          changelogExact > changelogClose,
  "the optional client must arm across headers/body, join, close TLS, then retain decoded_len+1 bytes");
assert.match(changelogFetch, /transport_type\s*=\s*HTTP_TRANSPORT_OVER_SSL/,
  "changelog fetch must force the SSL transport");
assert.match(changelogFetch, /disable_auto_redirect\s*=\s*true/,
  "changelog fetch must not follow unchecked redirects");
assert.match(changelogFetch,
  /manifest_changelog\(document\.get\(\),\s*got,\s*expected_version,\s*document\.get\(\),\s*OTA_CHANGELOG_TEXT_MAX\s*\+\s*1\)/,
  "release notes must be version-bound, decoded in place and capped to the declared text budget");
assert.match(headroom,
  /OTA_CHANGELOG_HEADROOM\s*=\s*OTA_TRANSFER_HEADROOM/,
  "the courtesy TLS client must inherit the measured dynamic-TLS transfer budget without drift");
assert.match(changelogFetch,
  /wait_for_ota_headroom\(\s*"changelog"\s*,\s*OTA_CHANGELOG_HEADROOM\s*,\s*kTransferHeadroomMaxAttempts/,
  "the courtesy TLS client must require the same four stable headroom samples as manifest/image TLS");
assert.match(changelogFetch,
  /while\s*\(got\s*<\s*kChangelogDocumentMax\)\s*\{[\s\S]{0,220}?if\s*\(\s*!set_http_timeout_to_deadline\(c,\s*changelog_started,\s*kChangelogDeadline/,
  "a trickling changelog body must remain inside its absolute operation deadline");
assert.match(changelogFetch,
  /esp_http_client_fetch_headers\(c\)[\s\S]{0,120}?socket_deadline\.expired\(\)/,
  "a trickling changelog header must be interrupted by the socket watchdog");
assert.match(changelogFetch,
  /esp_http_client_read\(c,[\s\S]{0,180}?socket_deadline\.expired\(\)[\s\S]{0,160}?timed_out\s*=\s*true/,
  "a partial changelog body return after socket shutdown must remain a timeout");
assert.match(ota,
  /kChangelogTimerTickTicks\s*=\s*pdMS_TO_TICKS\(1000\)[\s\S]{0,160}?kChangelogLeaseTtlUs\s*=\s*60LL\s*\*\s*1000LL\s*\*\s*1000LL[\s\S]{0,500}?StaticTimer_t\s+s_changelog_timer_storage/,
  "unused retained notes must have a short TTL and statically allocated retry timer");
assert.match(ota,
  /xTimerCreateStatic\("ota_notes",\s*kChangelogTimerTickTicks,\s*pdTRUE,[\s\S]{0,220}?changelog_lease_expired/,
  "the changelog TTL must not introduce a resident heap-allocated timer");
assert.doesNotMatch(ota, /xTimerCreate\s*\(/,
  "the changelog TTL must keep timer control storage out of the heap");
assert.match(ota,
  /void\s+changelog_lease_expired\([\s\S]{0,220}?Lock\s+lk\(s_mtx,\s*0\);[\s\S]{0,80}?if\s*\(!lk\)\s*return;/,
  "the shared timer daemon must try-lock and rely on its auto-reload retry, never block on OTA");
const startLockedStart = ota.indexOf("uint32_t start_locked(");
const startLockedEnd = ota.indexOf("uint32_t start_check(", startLockedStart);
const startLocked = ota.slice(startLockedStart, startLockedEnd);
assert.match(startLocked,
  /ensure_changelog_timer_locked\(\)[\s\S]{0,120}?xTimerStop\(s_changelog_timer,\s*0\)[\s\S]{0,120}?clear_changelog_lease_locked\(\)[\s\S]{0,500}?xTaskCreate\(/,
  "retained courtesy text must be released before any next OTA task, including the update");
assert.match(ota,
  /bool\s+ota_changelog_release\([\s\S]{0,500}?clear_changelog_lease_locked\(\)/,
  "the HTTP handler must be able to release retained notes on success or send failure");

const firmwareHttps = update.indexOf("ota_url_is_absolute_https(url)");
assert.ok(firmwareHttps >= 0 && init > firmwareHttps,
  "a firmware URL must pass absolute HTTPS policy before a client is allocated");
assert.match(update, /transport_type\s*=\s*HTTP_TRANSPORT_OVER_SSL/,
  "firmware fetch must force the SSL transport");
assert.match(update, /disable_auto_redirect\s*=\s*true/,
  "firmware fetch must disable automatic redirects so only the checked Location path can follow");
assert.match(update, /event_handler\s*=\s*firmware_http_event/,
  "firmware redirects must be inspected before the client follows them");
assert.match(update, /user_data\s*=\s*&response_state/,
  "the HTTP callback must receive the per-operation redirect and range verdicts");

const eventStart = ota.indexOf("esp_err_t firmware_http_event(");
const eventEnd = ota.indexOf("esp_err_t open_firmware_stream(", eventStart);
assert.ok(eventStart >= 0 && eventEnd > eventStart,
  "the redirect-header policy boundary must remain identifiable");
const event = ota.slice(eventStart, eventEnd);
assert.match(event, /HTTP_EVENT_ON_HEADER/,
  "only received response headers may update redirect policy");
assert.match(event, /ota_ascii_prefix_ieq\(key,\s*"Location"\)/,
  "Location matching must be ASCII case-insensitive");
assert.match(event, /ota_redirect_location_observe\(response->redirect,\s*event->header_value\)/,
  "every redirect Location header must enter the duplicate-aware policy");
assert.match(event, /ota_ascii_prefix_ieq\(key,\s*"Content-Range"\)[\s\S]{0,120}?ota_content_range_observe\(response->content_range,\s*event->header_value\)/,
  "every Content-Range header must enter the duplicate-aware allocation-free policy");
assert.match(event, /firmware_http_event\([^)]*\)\s*noexcept/,
  "the HTTP parser callback must not unwind through ESP-IDF C frames");

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
const streamDeadline = stream.indexOf(
  "set_http_timeout_to_deadline(client, operation_started, operation_deadline)");
const redirectReset = stream.indexOf("ota_redirect_location_reset(response.redirect)");
const rangeReset = stream.indexOf("ota_content_range_reset(response.content_range)");
const redirectVerdict = stream.indexOf("!ota_redirect_location_accepted(response.redirect)");
const setRedirect = stream.indexOf("esp_http_client_set_redirection(");
const redirectClose = stream.indexOf("esp_http_client_close(", setRedirect);
const clearResponse = stream.indexOf("esp_http_client_clear_response_buffer(", redirectClose);
const secondStreamDeadline = stream.indexOf(
  "set_http_timeout_to_deadline(client, operation_started, operation_deadline)",
  streamDeadline + 1);
const armSocketDeadline = stream.indexOf(
  "socket_deadline.arm(client, operation_started, operation_deadline)", secondStreamDeadline);
const fetchHeaders = stream.indexOf("esp_http_client_fetch_headers(client)");
const postHeaderDeadline = stream.indexOf(
  "socket_deadline.expired()", fetchHeaders);
const redirectDisarm = stream.indexOf("socket_deadline.disarm()", setRedirect);
assert.ok(streamDeadline >= 0 && redirectReset > streamDeadline && rangeReset > redirectReset &&
          secondStreamDeadline > rangeReset && armSocketDeadline > secondStreamDeadline &&
          fetchHeaders > armSocketDeadline &&
          postHeaderDeadline > fetchHeaders &&
          redirectVerdict > postHeaderDeadline &&
          setRedirect > redirectVerdict &&
          redirectDisarm > setRedirect && redirectClose > redirectDisarm &&
          clearResponse > redirectClose,
  "each stream must arm before headers, then join before a redirected socket is cleared/reopened");

// ── Two exact, fail-closed mid-stream resumes ────────────────────────────────────────────────
// Dynamic TLS records can lose allocations or socket reads after the OTA slot/hash are already
// partially advanced. Recovery stays inside the accepted operation: at most two fresh HTTPS
// clients ask for the exact remaining suffix while the original OTA handle, PSA hash and absolute
// deadline remain authoritative. Every resumed stream must advance before another reconnect.
assert.match(transport, /OTA_TRANSFER_MAX_RESUMES\s*=\s*2/,
  "a transfer may reconnect at most twice, never loop until a broken network happens to pass");
assert.match(transport,
  /resumes\s*<\s*OTA_TRANSFER_MAX_RESUMES[\s\S]{0,160}?total\s*>\s*0[\s\S]{0,120}?stream_started_at\s*<\s*written[\s\S]{0,80}?written\s*<\s*total/,
  "resume must require unused budget and progress in the current known-size image stream");
assert.match(transport,
  /state\.header_count\s*==\s*1[\s\S]{0,160}?state\.start\s*==\s*expected_start[\s\S]{0,120}?state\.end\s*==\s*expected_total\s*-\s*1[\s\S]{0,120}?state\.total\s*==\s*expected_total/,
  "the resumed suffix must carry exactly one complete matching Content-Range");
assert.match(transport, /numeric_limits<uint64_t>::max\(\)\s*-\s*digit/,
  "Content-Range decimal parsing must reject uint64 overflow without allocation");

const resumeDecision = update.indexOf("const bool can_resume");
const resumeIncrement = update.indexOf("++resumes", resumeDecision);
const resumeDiag = update.indexOf("http_client_log_read_failure(", bulkRead);
const resumeFree = update.indexOf("heap_caps_free(buffer)", resumeDecision);
const resumeClose = update.indexOf("close_http_client(client, socket_deadline)", resumeFree);
const resumeHeadroom = update.indexOf('wait_for_ota_headroom_until("transfer resume"', resumeClose);
const resumeGateDeadline = update.indexOf(
  "if (http_deadline_reached(transfer_started, kFirmwareDeadline))", resumeHeadroom);
const resumeInit = update.indexOf("esp_http_client_init(&http)", resumeHeadroom);
const resumeHeader = update.indexOf('esp_http_client_set_header(client, "Range", range_header)', resumeInit);
const resumeOpen = update.indexOf(
  "open_firmware_stream(client, response_state, socket_deadline, 206, transfer_started,",
  resumeHeader);
const resumeRange = update.indexOf("ota_content_range_matches(", resumeOpen);
const resumeChunked = update.indexOf("esp_http_client_is_chunked_response(client)", resumeRange);
const resumeLength = update.indexOf("response_length", resumeChunked);
const resumeBuffer = update.indexOf("heap_caps_malloc(kOtaBufSize", resumeLength);
const resumeProgressOrigin = update.indexOf("stream_started_at = resume_at", resumeBuffer);
assert.ok(resumeDiag > bulkRead && resumeDecision > resumeDiag &&
          resumeIncrement > resumeDecision && resumeFree > resumeIncrement &&
          resumeClose > resumeFree && resumeHeadroom > resumeClose &&
          resumeGateDeadline > resumeHeadroom && resumeInit > resumeGateDeadline &&
          resumeHeader > resumeInit && resumeOpen > resumeHeader && resumeRange > resumeOpen &&
          resumeChunked > resumeRange && resumeLength > resumeChunked && resumeBuffer > resumeLength &&
          resumeProgressOrigin > resumeBuffer,
  "a failed read must release TLS/buffer, regain headroom, validate exact 206 range metadata, and remember the accepted suffix origin");
assert.match(update.slice(resumeDiag, resumeHeadroom),
  /http_deadline_reached\(transfer_started, kFirmwareDeadline\)/,
  "resume admission must use the original firmware deadline rather than start a new budget");
assert.match(update.slice(resumeClose, resumeInit), /OTA_TRANSFER_HEADROOM/,
  "the reconnect must reacquire the same stable 56/24-KiB TLS headroom");
assert.match(update.slice(resumeClose, resumeInit),
  /kTransferHeadroomMaxAttempts,\s*transfer_started,\s*kFirmwareDeadline,\s*resume_heap/,
  "the reconnect headroom wait must consume the original absolute transfer deadline");
assert.match(stream,
  /set_http_timeout_to_deadline\(client, operation_started, operation_deadline\)[\s\S]{0,500}?esp_http_client_open\(client, 0\)[\s\S]{0,500}?set_http_timeout_to_deadline\(client, operation_started, operation_deadline\)[\s\S]{0,300}?socket_deadline\.arm\(client, operation_started, operation_deadline\)[\s\S]{0,300}?esp_http_client_fetch_headers\(client\)[\s\S]{0,180}?socket_deadline\.expired\(\)/,
  "open consumes the IDF timeout, then every header/body socket phase uses the original absolute deadline");
assert.match(stream,
  /esp_http_client_open\(client, 0\)[\s\S]{0,180}?e\s*!=\s*ESP_OK[\s\S]{0,300}?http_deadline_reached\(operation_started, operation_deadline\)[\s\S]{0,180}?ESP_ERR_TIMEOUT\s*:\s*e/,
  "a blocking TLS-open failure that exhausts the operation deadline must remain a timeout");
assert.match(stream,
  /header_result\s*=\s*esp_http_client_fetch_headers\(client\)[\s\S]{0,120}?socket_deadline\.expired\(\)[\s\S]{0,100}?ESP_ERR_TIMEOUT[\s\S]{0,180}?header_result\s*<\s*0/,
  "socket-shutdown header failures must be classified as timeout before generic response failure");
assert.match(update.slice(resumeInit, resumeOpen), /bytes=%llu-/,
  "the reconnect must request exactly the suffix beginning at the committed byte count");
assert.match(update.slice(resumeOpen, resumeBuffer),
  /response_length\s*<\s*0\s*\|\|[\s\S]{0,120}?static_cast<uint64_t>\(response_length\)\s*!=\s*remaining/,
  "the 206 response Content-Length must equal the exact remaining image bytes");
assert.doesNotMatch(update, /esp_ota_resume|esp_ota_write_with_offset/,
  "range recovery must continue the live sequential OTA/hash contexts, not create offset state");
assert.equal(occurrences(update, "esp_ota_begin("), 1,
  "range recovery must not erase/reopen the OTA slot");
assert.equal(occurrences(update, "psa_hash_setup("), 1,
  "range recovery must not reset the exact-artifact hash");
assert.match(update,
  /const bool complete\s*=\s*transfer_ok\s*&&\s*response_complete[\s\S]{0,120}?written\s*==\s*static_cast<uint64_t>\(total\)/,
  "final validation must still require a complete final response and the original total byte count");
const readDiagStart = httpClientDiag.indexOf("HttpClientReadFailure http_client_log_read_failure(");
assert.ok(readDiagStart >= 0, "the allocation-free mid-stream diagnostic boundary must exist");
assert.match(httpClientDiag.slice(readDiagStart),
  /read_result[\s\S]{0,500}?esp_http_client_get_errno\(client\)[\s\S]{0,220}?esp_http_client_get_and_clear_last_tls_error[\s\S]{0,900}?largest_internal/,
  "mid-stream failure evidence must capture raw read, socket, TLS and contiguous heap before cleanup");

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
assert.match(update,
  /allocator_failure[\s\S]{0,240}?e\s*==\s*ESP_ERR_TIMEOUT\s*\?\s*"Update download timed out"[\s\S]{0,180}?status\s*==\s*0/,
  "an initial firmware open that consumes the deadline must not be mislabeled as reachability");
assert.match(update.slice(resumeOpen, resumeRange),
  /e\s*==\s*ESP_ERR_TIMEOUT\s*\?\s*OtaTransferFailure::Timeout\s*:\s*OtaTransferFailure::Read/,
  "a resumed open that consumes the remaining deadline must retain timeout diagnostics");

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
const pauseStart = mqtt.indexOf(
  "static __attribute__((noinline)) void mqtt_transport_pause_if_requested(");
const holdStart = mqtt.indexOf(
  "static __attribute__((noinline)) bool mqtt_network_hold_step(", pauseStart);
const resumeStart = mqtt.indexOf(
  "static __attribute__((noinline)) bool mqtt_transport_resume_step(", holdStart);
const resumeEnd = mqtt.indexOf("static std::string board_id(", resumeStart);
assert.ok(pauseStart >= 0 && holdStart > pauseStart && resumeStart > holdStart &&
          resumeEnd > resumeStart,
  "the stack-bounded MQTT pause/hold/resume helpers must remain explicit call boundaries");
const pauseStep = mqtt.slice(pauseStart, holdStart);
const holdStep = mqtt.slice(holdStart, resumeStart);
const resumeStep = mqtt.slice(resumeStart, resumeEnd);
assert.match(pauseStep,
  /s_transport_pause_requested\.load\(std::memory_order_acquire\)[\s\S]{0,220}?esp_mqtt_client_stop\(s_client\)[\s\S]{0,260}?s_client_running\.store\(false,\s*std::memory_order_release\)[\s\S]{0,260}?s_transport_paused\.store\(true,\s*std::memory_order_release\)/,
  "the MQTT owner must stop and acknowledge esp-mqtt before a competing TLS session starts");
assert.match(holdStep,
  /ota_quiesce_step\(quiesce, network_busy\)[\s\S]{0,600}?mqtt_transport_pause_if_requested\(\)[\s\S]{0,180}?s_publish_network_quiesced\.store\(true,\s*std::memory_order_release\)[\s\S]{0,120}?vTaskDelay\([\s\S]{0,100}?return true;/,
  "the held MQTT helper must stop transport, acknowledge quiescence and leave before allocation");
const mqttTaskStart = mqtt.indexOf("static void mqtt_task(");
const mqttTaskEnd = mqtt.indexOf("static bool build_client(", mqttTaskStart);
assert.ok(mqttTaskStart >= 0 && mqttTaskEnd > mqttTaskStart,
  "the MQTT publish task must remain identifiable");
const mqttTask = mqtt.slice(mqttTaskStart, mqttTaskEnd);
const heldCallAt = mqttTask.indexOf("mqtt_network_hold_step(");
const heldContinueAt = mqttTask.indexOf("continue;", heldCallAt);
const activityAt = mqttTask.indexOf("MqttPublishActivity publish_activity", heldContinueAt);
const resumeCallAt = mqttTask.indexOf("mqtt_transport_resume_step(", activityAt);
assert.ok(heldCallAt >= 0 && heldContinueAt > heldCallAt && activityAt > heldContinueAt &&
          resumeCallAt > activityAt,
  "mqtt_task must leave a held cycle before constructing publish state and resume via its helper");
const resumeAt = resumeStep.indexOf("s_transport_paused.load(std::memory_order_acquire)");
const tlsResumeAt = resumeStep.indexOf("mqtt_transport_tls_configured()", resumeAt);
const freeResumeAt = resumeStep.indexOf("free_internal < kMqttTlsResumeMinFree", tlsResumeAt);
const largestResumeAt = resumeStep.indexOf("largest < kMqttTlsResumeMinLargest", freeResumeAt);
const stableResumeAt = resumeStep.indexOf("++state.stable_samples < kMqttTlsResumeStableSamples",
                                         largestResumeAt);
const startResumeAt = resumeStep.indexOf("start_client_transport()", stableResumeAt);
const backoffResumeAt = resumeStep.indexOf("state.wait_s = state.backoff_s", startResumeAt);
const runningResumeAt = resumeStep.indexOf(
  "s_client_running.store(true, std::memory_order_release)", startResumeAt);
assert.ok(resumeAt >= 0 && tlsResumeAt > resumeAt && freeResumeAt > tlsResumeAt &&
          largestResumeAt > freeResumeAt && stableResumeAt > largestResumeAt &&
          startResumeAt > stableResumeAt && backoffResumeAt > startResumeAt &&
          runningResumeAt > backoffResumeAt,
  "MQTTS resume must pass stable free/largest admission and failed starts must back off before the client is marked running");
assert.match(mqtt,
  /kMqttTlsResumeMinFree\s*=\s*56 \* 1024[\s\S]{0,120}?kMqttTlsResumeMinLargest\s*=\s*24 \* 1024[\s\S]{0,120}?kMqttTlsResumeStableSamples\s*=\s*4/,
  "MQTTS resume must use the same measured stable TLS floor as OTA/Weather");
assert.match(resumeStep,
  /state\.backoff_s < kMqttResumeBackoffMaxS \/ 2[\s\S]{0,180}?kMqttResumeBackoffMaxS/,
  "direct esp-mqtt restart failures must have a bounded exponential retry interval");
assert.match(mainCmake,
  /set_source_files_properties\(mqtt_ha\.cpp PROPERTIES COMPILE_OPTIONS\s*"-fno-inline-functions-called-once;-Werror=frame-larger-than=2048"\)/,
  "the size-optimised MQTT object must retain helper boundaries and fail above its measured fixed-frame ceiling");
assert.match(mqtt,
  /struct\s+MqttStartupActivity[\s\S]{0,800}?s_publish_network_quiesced\.store\(false,\s*std::memory_order_release\)[\s\S]{0,300}?if\s*\(!competing_tls_active\(\)\)\s*return;[\s\S]{0,200}?s_publish_network_quiesced\.store\(true,\s*std::memory_order_release\)/,
  "MQTT startup must claim/recheck and yield to an OTA that began before mqtt_ha_start");
const promoteStart = mqtt.indexOf("static bool promote_client_to_publisher() {");
const promoteEnd = mqtt.indexOf("\n}\n\nvoid mqtt_ha_start()", promoteStart);
const promote = mqtt.slice(promoteStart, promoteEnd);
const promoteStop = promote.indexOf("esp_mqtt_client_stop(s_client)");
const promoteTransportClear = promote.indexOf(
  "s_transport_connecting.store(false, std::memory_order_release)", promoteStop);
const promoteDestroy = promote.indexOf("esp_mqtt_client_destroy(s_client)", promoteTransportClear);
assert.ok(promoteStart >= 0 && promoteEnd > promoteStart && promoteStop >= 0 &&
          promoteTransportClear > promoteStop && promoteDestroy > promoteTransportClear,
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
const modbusPollCall = modbusTask.indexOf("mb_poll_once()", modbusRecheck);
const modbusPollStart = modbus.indexOf("static void mb_poll_once()");
const modbusPollEnd = modbus.indexOf("static void mb_task_start_if_enabled()", modbusPollStart);
const modbusPoll = modbus.slice(modbusPollStart, modbusPollEnd);
assert.ok(modbusOtaHold >= 0 && modbusWeatherHold > modbusOtaHold &&
          modbusClaim > modbusWeatherHold && modbusRecheck > modbusClaim &&
          modbusPollCall > modbusRecheck,
  "HomeHub must claim/recheck and stand aside before its Config copy and model-sized cycle allocation");
assert.match(modbusTask.slice(modbusOtaHold, modbusPollCall),
  /vTaskDelay\([\s\S]*?continue;/,
  "the HomeHub network hold must yield at its ordinary cadence");
assert.match(modbusPoll, /const Config& c = config\(\);[\s\S]*?std::vector/,
  "the allocation-rich HomeHub cycle must still own the Config snapshot and model-sized values");
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
const weatherNetworkStart = weather.indexOf("NetworkActivity activity(source_generation)");
const weatherNetworkEnd = weather.indexOf("ok = fetch_forecast(", weatherNetworkStart);
const weatherNetwork = weather.slice(weatherNetworkStart, weatherNetworkEnd);
const weatherModbusWait = weatherNetwork.indexOf("!mb_network_quiesced()");
const weatherSyslogWait = weatherNetwork.indexOf("!syslog_network_quiesced()", weatherModbusWait);
const weatherModbusVerdict = weatherNetwork.indexOf(
  "modbus_quiesce_failed = !mb_network_quiesced()", weatherSyslogWait);
const weatherSyslogVerdict = weatherNetwork.indexOf(
  "syslog_quiesce_failed = !syslog_network_quiesced()", weatherModbusVerdict);
assert.ok(weatherNetworkStart >= 0 && weatherNetworkEnd > weatherNetworkStart &&
  weatherModbusWait >= 0 && weatherSyslogWait > weatherModbusWait &&
  weatherModbusVerdict > weatherSyslogWait && weatherSyslogVerdict > weatherModbusVerdict,
  "Weather TLS must wait for HomeHub and Syslog acknowledgements too");

const pollBarrierStart = ota.indexOf("bool wait_for_poll_quiesce(");
const pollBarrierEnd = ota.indexOf("bool wait_for_mqtt_quiesce(", pollBarrierStart);
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
const weatherLeaseStart = weather.indexOf("struct NetworkActivity {");
const weatherLeaseEnd = weather.indexOf("\n};", weatherLeaseStart);
const weatherLease = weather.slice(weatherLeaseStart, weatherLeaseEnd);
const weatherPause = weatherLease.indexOf("mqtt_transport_pause_for_network_heap()");
const weatherResume = weatherLease.indexOf("mqtt_transport_resume_after_network_heap()",
                                           weatherPause);
const weatherRelease = weatherLease.indexOf("release_admission()", weatherResume);
const weatherPendingHandoff = weatherLease.indexOf("SourceAdmission::SourceChangePending",
                                                    weatherRelease);
const weatherIdleRelease = weatherLease.indexOf("SourceAdmission::Idle", weatherPendingHandoff);
assert.ok(weatherLeaseStart >= 0 && weatherLeaseEnd > weatherLeaseStart && weatherPause >= 0 &&
  weatherResume > weatherPause && weatherRelease > weatherResume &&
  weatherPendingHandoff > weatherRelease && weatherIdleRelease > weatherPendingHandoff,
  "the Weather network lease must pause/resume MQTT and then hand off or release admission");

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
