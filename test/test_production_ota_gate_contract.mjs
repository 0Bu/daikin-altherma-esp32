// Deterministic source-boundary contract for the role-pinned OTA/HIL gate. Real board behaviour is
// proved only by the release-hil job; this test keeps the fail-closed host and firmware wiring from
// becoming optional or silently changing shape.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const defaultRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const root = path.resolve(process.env.PRODUCTION_OTA_CONTRACT_ROOT || defaultRoot);
const read = rel => fs.readFileSync(path.join(root, rel), "utf8");
const occurrences = (text, token) => text.split(token).length - 1;
const section = (text, start, end) => {
  const first = text.indexOf(start);
  const last = text.indexOf(end, first + start.length);
  assert.ok(first >= 0 && last > first, `missing source section ${start}`);
  return text.slice(first, last);
};

const gate = read("scripts/production-ota-gate.py");
const workflow = read(".github/workflows/build.yml");
const ota = read("main/ota_update.cpp");
const httpOta = read("main/http_ota.cpp");
const otaHilFeed = read("main/logic/ota_hil_feed.hpp");
const httpConfig = read("main/http_config.cpp");
const httpStatus = read("main/http_status.cpp");
const weatherSource = read("main/weather_forecast.cpp");
const weatherHeader = read("main/weather_forecast.hpp");
const weatherLogic = read("main/logic/weather_forecast.hpp");
const stackWatch = read("main/stack_watch.hpp");
const heartbeat = read("main/logic/heartbeat.hpp");
const health = read("main/logic/health_gate.hpp");
const mqtt = read("main/mqtt_ha.cpp");
const hook = read("tools/agent-hooks/agent_hook.py");

const abbreviated = spawnSync("python3", [
  path.join(root, "scripts/production-ota-gate.py"), "--manifest", "https://invalid/manifest.json",
], { encoding: "utf8" });
assert.equal(abbreviated.status, 2, "argparse abbreviations must fail before device contact");
assert.match(abbreviated.stderr, /unrecognized arguments: --manifest/);
if (!process.env.PRODUCTION_OTA_CONTRACT_ROOT) {
  const selfTest = spawnSync("python3", [
    "-I", "-B", path.join(root, "scripts/production-ota-gate.py"), "--self-test",
  ], { encoding: "utf8" });
  assert.equal(selfTest.status, 0, `OTA/HIL self-test failed: ${selfTest.stderr}`);
}

// Role, artifact and timing boundaries.
assert.match(gate, /BENCH_ROLE\s*=\s*"bench"[\s\S]{0,100}?PRODUCTION_ROLE\s*=\s*"production"/);
assert.match(gate, /bench and production inventory identities must be distinct/);
assert.doesNotMatch(gate, /192\.168\.|(?:[0-9A-F]{2}:){5}[0-9A-F]{2}/,
  "tracked gate source must contain no private board identity");
assert.match(gate, /STRESS_SECONDS\s*=\s*180/);
assert.ok(Number(gate.match(/OTA_CHECK_TIMEOUT_S\s*=\s*(\d+)/)?.[1]) >= 120);
assert.ok(Number(gate.match(/OTA_TIMEOUT_S\s*=\s*(\d+)/)?.[1]) >= 480);
assert.match(gate, /PROMOTION_READY_STABLE_SAMPLES\s*=\s*2/,
  "production promotion must not trust one potentially straddled MQTT/Weather snapshot");
assert.match(gate, /PROMOTION_READY_SAMPLE_INTERVAL_S\s*=\s*0\.1/);
assert.match(gate, /OFFICIAL_MANIFEST_URL\s*=\s*"https:\/\/0bu\.github\.io\/daikin-altherma-esp32\/dev\/manifest\.json"/);
assert.match(gate, /OFFICIAL_RELEASE_MANIFEST_URL\s*=\s*"https:\/\/0bu\.github\.io\/daikin-altherma-esp32\/manifest\.json"/);
assert.match(gate, /LEGACY_BENCH_RESTORE_MANIFEST_MAX_BYTES\s*=\s*1024/);
assert.match(gate, /LEGACY_RELEASE_VERSION\s*=\s*"1\.0\.2"/);
assert.match(gate, /LEGACY_RELEASE_SOURCE_SHA\s*=\s*"cc29e8c6e593570140e6446b07520216251939ed"/);
assert.match(gate, /LEGACY_RELEASE_APP_SHA256\s*=\s*"c8437cb546175fa9591dcce9e137c35ec6ea3028c64678b08e029392cb9ea4ce"/);
assert.match(gate, /LEGACY_RELEASE_ELF_ID\s*=\s*"123d9f795"/);
assert.match(gate, /hashlib\.sha256\(binary\)\.hexdigest\(\)/);
assert.match(gate, /scripts\/require-signed\.sh/);
assert.match(gate, /"Range": "bytes=0-0"/);
assert.doesNotMatch(gate, /add_argument\([^\n]*(?:skip|short|no[-_]stress)/i,
  "hardware acceptance must expose no skip/short bypass");

const restoreCompatibility = section(
  gate, "def require_legacy_bench_restore_manifest(", "\ndef validate_release_manifest(",
);
assert.match(restoreCompatibility,
  /len\(manifest_bytes\)\s*>\s*LEGACY_BENCH_RESTORE_MANIFEST_MAX_BYTES/);
assert.match(restoreCompatibility, /"artifacts" in manifest/);
assert.match(restoreCompatibility, /manifest_bytes\.decode\("ascii"\)/);
assert.match(restoreCompatibility, /if b"\\\\" in manifest_bytes:/);
const releaseSourceBinding = section(
  gate, "def require_release_source_binding(", "\ndef verify_release_source_binding(",
);
assert.match(releaseSourceBinding,
  /\(version, source_sha, app_sha256\)\s*==\s*\([\s\S]*?LEGACY_RELEASE_VERSION,[\s\S]*?LEGACY_RELEASE_SOURCE_SHA,[\s\S]*?LEGACY_RELEASE_APP_SHA256/);
assert.match(releaseSourceBinding, /if source_sha == tagged_source:/);
const limitedRemoteDocument = section(
  gate, "def request_limited_bytes(", "\ndef request_json(",
);
assert.match(limitedRemoteDocument, /declared_size\s*>\s*max_bytes/);
assert.match(limitedRemoteDocument, /response\.read\(max_bytes \+ 1\)/);
assert.match(limitedRemoteDocument, /len\(payload\)\s*>\s*max_bytes/);
assert.match(limitedRemoteDocument, /threading\.Thread\([\s\S]{0,140}?daemon=True\)\.start\(\)/);
assert.match(limitedRemoteDocument, /if not completed\.wait\(timeout\):/,
  "bounded manifest fetches must have a whole-operation deadline, not only socket inactivity timeouts");
const devManifestSnapshot = section(
  gate, "def require_official_dev_manifest_snapshot(", "\ndef validate_release_manifest(",
);
assert.match(devManifestSnapshot,
  /manifest_bytes\s*=\s*request_limited_bytes\([\s\S]{0,220}?LEGACY_BENCH_RESTORE_MANIFEST_MAX_BYTES/,
  "every official dev-feed rebind must remain bounded to the legacy parser ceiling");
const ordinaryMain = gate.slice(gate.indexOf("def main()"));
const rawDevManifest = ordinaryMain.indexOf("manifest_bytes = request_limited_bytes(");
const restorePreflight = ordinaryMain.indexOf(
  "require_legacy_bench_restore_manifest(manifest_bytes, manifest)", rawDevManifest,
);
const inventoryRead = ordinaryMain.indexOf("inventory = load_inventory()", restorePreflight);
const releaseSourceCheck = ordinaryMain.indexOf(
  "verify_release_source_binding(release_version, release_source_sha, release_sha256)",
  inventoryRead,
);
const limitedReleaseManifest = ordinaryMain.indexOf(
  "release_manifest_bytes = request_limited_bytes(", inventoryRead,
);
const benchContact = ordinaryMain.indexOf('request_json(bench["host"], "/status")', releaseSourceCheck);
const benchDowngrade = ordinaryMain.indexOf("exercise_bench_full_download(", benchContact);
assert.ok(rawDevManifest >= 0 && restorePreflight > rawDevManifest &&
  inventoryRead > restorePreflight && limitedReleaseManifest > inventoryRead &&
  releaseSourceCheck > limitedReleaseManifest &&
  benchContact > releaseSourceCheck &&
  benchDowngrade > benchContact,
  "restore compatibility and release source binding must precede all bench mutation");

// One resolved identity owns every pre-write and pressure request.
const boundedTransport = section(gate, "def read_bounded_http_response(", "\ndef verify_http_range_support(");
assert.match(boundedTransport, /HTTP_HEADER_MAX_BYTES/);
assert.match(boundedTransport, /transfer_encodings\[0\]\s*!=\s*b"chunked"/);
assert.match(boundedTransport, /HTTP_CHUNK_LINE_MAX_BYTES/);
assert.match(boundedTransport, /chunk_size\s*>\s*max_body_bytes\s*-\s*len\(body\)/);
assert.match(boundedTransport, /trailers or bytes after its terminator/);
assert.match(boundedTransport, /CompactTransportError/);
assert.match(boundedTransport, /deadline\s*-\s*time\.monotonic\(\)/);
assert.match(gate, /STATUS_MAX_BYTES\s*=\s*32\s*\*\s*1024/);
assert.match(gate, /VALUES_MAX_BYTES\s*=\s*128\s*\*\s*1024/);

const stress = section(gate, "def stress_board(", "\ndef verify_retained_x10a(");
assert.match(stress, /pinned_endpoint\s*=\s*resolve_http_endpoint\(host\)/);
assert.match(stress, /request_status_deadline\(\s*pinned_endpoint/);
assert.match(stress, /request_values_deadline\(pinned_endpoint/);
assert.match(stress, /request_diag_deadline\(pinned_endpoint/);
assert.doesNotMatch(stress, /request_bytes\(f"http:\/\/\{host\}/,
  "pressure evidence must not re-resolve the hostname per sample");
assert.match(stress, /validate_identity\(status, host=host, mac=mac, version=version, elf=elf\)/);
assert.match(stress, /required_uptime\(started/);
assert.match(stress, /required_uptime\(status/);
assert.match(stress, /required_uptime\(finished/);
assert.match(stress, /require_stress_ota_offer\([\s\S]{0,180}?expected_app_sha256[\s\S]{0,100}?expected_channel/);
assert.match(stress, /ready_deadline\s*=\s*time\.monotonic\(\)\s*\+\s*OTA_CHECK_TIMEOUT_S/);
const readinessCounters = stress.indexOf("initial_counters = board_counters(started)");
const readinessLoop = stress.indexOf("ready_deadline = time.monotonic() + OTA_CHECK_TIMEOUT_S");
const readinessBaseline = stress.indexOf("baseline = initial_counters", readinessLoop);
assert.ok(readinessCounters >= 0 && readinessCounters < readinessLoop &&
  readinessBaseline > readinessLoop,
  "the pressure baseline must cover the complete post-reboot readiness wait");
assert.match(stress,
  /if any\(initial_counters\[key\] != 0 for key in readiness_keys\):/,
  "readiness must start without a prior allocation failure");
assert.match(stress, /if ready_uptime < last_ready_uptime:/,
  "readiness must fail closed on a reboot");
assert.match(stress,
  /if any\(ready_counters\[key\] != initial_counters\[key\] for key in readiness_keys\):/,
  "readiness must fail closed when allocation counters change");
assert.match(stress,
  /if int\(ready_system\.get\("free_heap", 0\)\) < MIN_FINAL_FREE_HEAP or \\\s+int\(ready_system\.get\("max_alloc", 0\)\) < MIN_FINAL_LARGEST_BLOCK:\s+fail\(f"\{host\} readiness window ended without safe heap"\)/,
  "readiness must prove free and contiguous heap before pressure");
assert.match(stress,
  /if mqtt_connected is True and \(not require_weather or fetching is False\):/,
  "every post-reboot pressure path must wait boundedly for MQTT, even without Weather");
assert.match(stress, /MQTT did not connect before the pressure window/);
assert.match(stress, /weather did not become idle before its HIL refresh/);
assert.match(stress, /except HTTPError as error:[\s\S]{0,100}?error\.code != 503/,
  "only 503 may be retried during the explicit weather TLS window");
assert.match(stress,
  /weather_refresh_token, weather_successes_before = request_weather_refresh\([\s\S]{0,100}?pinned_endpoint, host, started/);
assert.match(gate, /"refresh": True/);
assert.match(stress,
  /refresh_fields\["refresh_completed_token"\] == weather_refresh_token[\s\S]{0,420}?refresh_fields\["refresh_requested_token"\] == weather_refresh_token[\s\S]{0,220}?refresh_fields\["refresh_started_token"\] == weather_refresh_token[\s\S]{0,220}?if not exact_attempt:[\s\S]{0,180}?refresh_fields\["refresh_success_token"\] != weather_refresh_token/,
  "live Weather acceptance must require the exact requested, started, completed and successful token");
assert.equal(occurrences(stress, "\n        weather_deadline ="), 1,
  "the under-pressure Weather observation must retain one absolute HIL deadline");
assert.match(stress,
  /remaining = weather_deadline - time\.monotonic\(\)[\s\S]{0,140}?if remaining <= 0:[\s\S]{0,100}?request_status_deadline\([\s\S]{0,100}?timeout=min\(remaining, 1\)/,
  "each Weather status poll must be clamped to the remaining absolute deadline");
assert.match(gate, /POST_STRESS_WEATHER_TIMEOUT_S\s*=\s*120/,
  "the one post-stress Weather recovery needs its own fixed deadline");
assert.match(gate, /POST_STRESS_HEADROOM_TIMEOUT_S\s*=\s*420/,
  "post-stress recovery must have a bounded passive headroom wait");
assert.match(gate, /POST_STRESS_HEADROOM_STABLE_SAMPLES\s*=\s*2/,
  "one transient heap sample must not trigger the sole recovery attempt");
assert.match(gate, /POST_STRESS_MIN_FREE_HEAP\s*=\s*56 \* 1024/);
assert.match(gate, /POST_STRESS_MIN_LARGEST_BLOCK\s*=\s*20 \* 1024/);
assert.match(weatherLogic, /WEATHER_FETCH_MIN_FREE_BYTES\s*=\s*56 \* 1024/,
  "the measured aggregate Weather reserve must remain unchanged");
assert.match(weatherLogic, /WEATHER_FETCH_MIN_LARGEST_BLOCK_BYTES\s*=\s*20 \* 1024/,
  "the contiguous Weather floor must admit the measured 22 KiB production block");
assert.doesNotMatch(gate, /WEATHER_HEADROOM_RETRY_DELAY_S/,
  "a headroom refusal must not be re-armed while the pressure workers are active");
assert.match(stress,
  /refresh_fields\["refresh_success_token"\] != weather_refresh_token:[\s\S]{0,900}?weather_candidate\.get\("fetching"\) is False[\s\S]{0,180}?weather_candidate\.get\("state"\) == "waiting"[\s\S]{0,180}?weather_candidate\.get\("reason"\) == "heap_headroom"[\s\S]{0,220}?weather_headroom_deferred = True[\s\S]{0,80}?break/,
  "only an exact completed heap-headroom refusal may be deferred until after stress");
assert.match(stress,
  /remaining = max\(0\.0, deadline - time\.monotonic\(\)\)[\s\S]{0,120}?worker\.join\(remaining \+ HTTP_TIMEOUT_S \+ 1\)[\s\S]{0,120}?if worker\.is_alive\(\):[\s\S]{0,140}?fail/,
  "every pressure worker must consume the shared stress deadline and be proven stopped");
const workerJoin = stress.indexOf("if worker.is_alive():");
const stressValidation = stress.indexOf("live stress produced too few successful samples");
const postStressRearm = stress.indexOf("next_token, next_successes = request_weather_refresh(");
assert.ok(workerJoin >= 0 && workerJoin < stressValidation && stressValidation < postStressRearm,
  "the sole headroom re-arm must follow worker shutdown and complete stress validation");
assert.match(stress, /if require_weather and weather_headroom_deferred:/,
  "post-stress recovery must not be conditional on a still-running worker");
assert.match(stress,
  /deferred_weather\.get\("refresh_requested_token"\) != failed_weather_refresh_token[\s\S]{0,220}?deferred_weather\.get\("refresh_started_token"\) != failed_weather_refresh_token[\s\S]{0,220}?deferred_weather\.get\("refresh_completed_token"\) != failed_weather_refresh_token[\s\S]{0,220}?deferred_weather\.get\("refresh_success_token"\) == failed_weather_refresh_token/,
  "a natural retry may change ordinary state but must not alter the exact failed HIL token");
assert.equal(occurrences(stress, "post_stress_headroom_deadline ="), 1,
  "the passive headroom deadline must never reset");
assert.match(stress,
  /remaining = post_stress_headroom_deadline - time\.monotonic\(\)[\s\S]{0,180}?request_status_deadline\([\s\S]{0,100}?timeout=min\(remaining, 1\)/,
  "every passive headroom poll must consume the remaining absolute deadline");
assert.match(stress,
  /int\(ready_system\.get\("free_heap", 0\)\) >= POST_STRESS_MIN_FREE_HEAP[\s\S]{0,160}?int\(ready_system\.get\("max_alloc", 0\)\) >= POST_STRESS_MIN_LARGEST_BLOCK[\s\S]{0,180}?stable_headroom_samples >= POST_STRESS_HEADROOM_STABLE_SAMPLES/,
  "the sole post-stress trigger must follow stable aggregate and contiguous headroom");
assert.match(stress,
  /next_token, next_successes = request_weather_refresh\([\s\S]{0,220}?if next_token == failed_weather_refresh_token:[\s\S]{0,180}?weather_refresh_token = next_token[\s\S]{0,120}?weather_successes_before = next_successes[\s\S]{0,180}?post_stress_weather_deadline = time\.monotonic\(\) \+ POST_STRESS_WEATHER_TIMEOUT_S/,
  "the sole post-stress re-arm must use a different token, success baseline and deadline");
assert.equal(occurrences(stress, "request_weather_refresh("), 2,
  "Weather HIL may issue only the initial refresh and one post-stress headroom recovery");
assert.equal(occurrences(stress, "post_stress_weather_deadline ="), 1,
  "the post-stress recovery deadline must never reset");
assert.match(stress,
  /remaining = post_stress_weather_deadline - time\.monotonic\(\)[\s\S]{0,180}?request_status_deadline\([\s\S]{0,100}?timeout=min\(remaining, 1\)/,
  "every post-stress Weather poll must consume the remaining absolute deadline");
assert.match(stress,
  /refresh_fields\["refresh_completed_token"\] == weather_refresh_token:[\s\S]{0,300}?refresh_fields\["refresh_success_token"\] == weather_refresh_token[\s\S]{0,300}?successes_after <= weather_successes_before[\s\S]{0,180}?weather_candidate\.get\("state"\) != "ok"[\s\S]{0,220}?fail\(f"\{host\} post-stress weather recovery failed"\)/,
  "a second refusal or any non-causal completion must remain terminal");
const postStressRecovery = stress.slice(postStressRearm);
assert.match(postStressRecovery, /MQTT did not recover after post-stress Weather TLS/,
  "post-stress success must prove MQTT recovery");
assert.match(postStressRecovery, /if recovered\.get\("mqtt", \{\}\)\.get\("connected"\):/,
  "post-stress recovery must wait for a genuinely connected MQTT snapshot");
assert.match(postStressRecovery,
  /for key in \("heap_restarts", "mqtt_skipped", "poll_skipped", "crc_err"\):[\s\S]{0,120}?if final\[key\] != baseline\[key\]:/,
  "post-stress recovery must recheck every allocation and protocol counter");
assert.match(postStressRecovery,
  /if require_x10a and \\\s+\(not final_hp\.get\("connected"\) or int\(final_hp\.get\("values", 0\)\) <= 0\):/,
  "post-stress recovery must recheck live X10A and positive values");
assert.match(postStressRecovery, /final_hp = finished\.get\("hp", \{\}\)/,
  "final X10A evidence must come from the recovered device snapshot");
assert.match(postStressRecovery, /changed during post-stress Weather recovery/,
  "post-stress success must retain the allocation and protocol counters");
assert.match(postStressRecovery, /rebooted during post-stress Weather recovery/,
  "post-stress success must retain monotonic uptime evidence");
const statusStress = section(stress, "    def status_loop()", "\n    def json_loop(");
assert.match(statusStress,
  /request_status_deadline\(\s*pinned_endpoint,\s*timeout=HTTP_TIMEOUT_S/,
  "the full chunked /status surface needs the ordinary HTTP deadline, not the compact OTA one");
assert.doesNotMatch(statusStress, /OTA_STATUS_REQUEST_TIMEOUT_S/,
  "the one-second deadline is reserved for compact /ota/status observation");
const jsonStress = section(stress, "    def json_loop(", "\n    workers = [");
assert.match(jsonStress,
  /time\.sleep\(min\(interval, max\(0\.0, deadline - time\.monotonic\(\)\)\)\)/,
  "the 15-second diagnostic cadence must not outlive the shared worker deadline");
const httpTimeoutMs = Number(gate.match(/HTTP_TIMEOUT_S\s*=\s*(\d+)/)?.[1]) * 1000;
const valuesWaitMs = Number(httpStatus.match(/kValuesTlsWait\s*=\s*pdMS_TO_TICKS\((\d+)\)/)?.[1]);
assert.ok(httpTimeoutMs > valuesWaitMs,
  "the full-status deadline must outlive the sole-worker bounded Weather wait");
assert.match(stress, /busy_503\["status"\][\s\S]{0,120}?busy_503\["values"\]/);
assert.match(stress, /disconnected \+= mqtt_recovery\.finish\(\)/);
assert.match(stackWatch, /Modbus,[\s\S]{0,120}?Weather,[\s\S]{0,120}?Ota,/,
  "Weather must own a boot-local high-water slot beside the other deep tasks");
assert.ok(occurrences(weatherSource, "stack_watch_sample(StackWatch::Weather)") >= 2,
  "Weather must sample both its loop lifecycle and the completed TLS/HTTP/JSON interval");
assert.match(httpStatus,
  /weather_forecast[\s\S]*?task_stack_min_free_bytes[\s\S]*?StackWatch::Weather/,
  "Weather status must expose its task-local high-water evidence");
assert.match(httpStatus,
  /stack_min_free_bytes[\s\S]*?j \+= ",\\"weather\\":";[\s\S]*?StackWatch::Weather/,
  "the always-on sys status must expose Weather stack evidence to HIL");
assert.match(heartbeat,
  /weather_stack_min_free_bytes[\s\S]*?append_stack_bytes\(j, f\.weather_stack_min_free_bytes\)/,
  "fleet heartbeat telemetry must retain Weather stack headroom");

const promotionSnapshot = section(
  gate, "def production_promotion_snapshot_ready(",
  "\ndef wait_for_production_promotion_readiness(",
);
assert.match(promotionSnapshot, /if uptime < last_uptime:/,
  "pre-write readiness must fail closed on a reboot");
assert.match(promotionSnapshot,
  /for key in \("heap_restarts", "mqtt_skipped", "poll_skipped", "crc_err"\):[\s\S]{0,140}?counters\[key\] != baseline_counters\[key\]/,
  "pre-write readiness must retain allocation and protocol counters");
assert.match(promotionSnapshot,
  /counters\["timeout_err"\] - baseline_counters\["timeout_err"\] > MAX_X10A_TIMEOUT_DELTA/,
  "pre-write readiness must retain the bounded X10A timeout delta");
assert.match(promotionSnapshot,
  /not hp\.get\("connected"\) or int\(hp\.get\("values", 0\)\) <= 0/,
  "pre-write readiness must retain live X10A with positive values");
assert.match(promotionSnapshot,
  /status\.get\("mqtt", \{\}\)\.get\("connected"\) is not True/);
assert.match(promotionSnapshot, /weather\["fetching"\] is not False/);
const promotionWait = section(
  gate, "def wait_for_production_promotion_readiness(", "\ndef require_stress_ota_offer(",
);
assert.match(promotionWait,
  /deadline = time\.monotonic\(\) \+ MQTT_RECOVERY_TIMEOUT_S/,
  "the pre-write recovery allowance must remain absolute and bounded");
assert.equal(occurrences(promotionWait, "deadline = time.monotonic() + MQTT_RECOVERY_TIMEOUT_S"), 1,
  "the pre-write recovery deadline must never reset");
assert.match(promotionWait, /status: dict\[str, Any\] \| None = initial/,
  "the initial readiness response must be represented as single-use evidence");
assert.match(promotionWait,
  /if status is not None:[\s\S]{0,900}?status = None[\s\S]{0,500}?time\.sleep/,
  "each successful readiness response must be invalidated before the next fetch");
assert.match(promotionWait, /validate_identity\(status, host=host, mac=mac, version=version, elf=elf\)/,
  "every successful pre-write status snapshot must retain the old production identity");
assert.match(promotionWait,
  /stable_samples = stable_samples \+ 1 if ready else 0[\s\S]{0,120}?stable_samples >= PROMOTION_READY_STABLE_SAMPLES/,
  "promotion needs consecutive quiescent samples");
assert.match(promotionWait,
  /request_status_deadline\([\s\S]{0,100}?endpoint, timeout=min\(remaining, HTTP_TIMEOUT_S\)/,
  "each pre-write status read must consume the remaining absolute deadline");
assert.match(promotionWait,
  /time\.sleep\(min\(PROMOTION_READY_SAMPLE_INTERVAL_S, remaining\)\)[\s\S]{0,140}?if remaining <= 0:[\s\S]{0,220}?fail\(/,
  "deadline expiry during the inter-sample wait must fail rather than reuse evidence");
assert.doesNotMatch(promotionWait, /if remaining <= 0:\s+continue/,
  "deadline expiry must never loop back to a consumed readiness sample");
assert.match(promotionWait, /if error\.code != 503:/,
  "only expected TLS-busy HTTP refusal may be retried before promotion");
assert.match(promotionWait,
  /except HTTPError as error:[\s\S]{0,180}?continue[\s\S]{0,120}?except \(CompactTransportError, OSError, TimeoutError\) as error:[\s\S]{0,160}?continue/,
  "a retryable transport gap must not reclassify the previous status snapshot");

const fullDownload = section(gate, "def exercise_bench_full_download(", "\ndef require_ota_transfer_evidence(");
for (const helper of ["request_status_deadline", "request_values_deadline", "request_diag_deadline"]) {
  assert.match(fullDownload, new RegExp(`${helper}\\(status_endpoint`),
    `bench binary pressure must use pinned ${helper}`);
}
assert.match(fullDownload,
  /pinned_release\s*=\s*request_status_deadline\(status_endpoint[\s\S]{0,240}?validate_identity\([\s\S]{0,300}?request_json_deadline\([\s\S]{0,120}?"\/ota\/check/,
  "the endpoint must be revalidated after the hostname-only health dwell and before restore");
assert.equal(occurrences(fullDownload, "require_official_dev_manifest_snapshot("), 2,
  "the mutable dev feed must be rebound before release selection and immediately before its write");
assert.match(fullDownload,
  /wait_for_ota_offer\([\s\S]{0,260}?expected_channel="dev"[\s\S]{0,220}?hil_manifest_url=OFFICIAL_RELEASE_MANIFEST_URL[\s\S]{0,160}?hil_firmware_base_url=OFFICIAL_RELEASE_FIRMWARE_BASE_URL/);
assert.match(fullDownload,
  /post_update_once\([\s\S]{0,180}?expected_channel="dev"[\s\S]{0,80}?allow_downgrade=True/,
  "the release write must consume the accepted transient HIL generation without persisting a channel switch");
assert.doesNotMatch(fullDownload, /set_update_channel/,
  "the bench release exercise must not persist a channel change before its sole write");
assert.match(fullDownload, /finally:[\s\S]{0,180}?stop\.set\(\)[\s\S]{0,180}?worker\.join/);

const transferObserver = section(
  gate, "def record_ota_transfer_evidence(", "\ndef wait_for_new_firmware(",
);
assert.match(transferObserver,
  /evidence\.get\("saw_done"\) is True and state != "done"/,
  "new-boot reset counters must not overwrite completed writer evidence");
assert.doesNotMatch(transferObserver,
  /if False and evidence\.get\("saw_done"\) is True and state != "done"/);
assert.match(transferObserver,
  /\("ota_stack_min_free_bytes",\s*"ota_stack_min_free_bytes"\)/,
  "the compact writer observer must retain OTA task evidence");
assert.match(transferObserver, /if isinstance\(value, int\) and not isinstance\(value, bool\):/,
  "numeric transfer evidence, including zero and negatives, must reach the verifier");
assert.match(transferObserver, /evidence\[f"\{target\}_invalid"\] = True/,
  "null, booleans and malformed transfer evidence must be retained as invalid");
assert.match(transferObserver, /ota_stack_present_at_done/);
assert.match(transferObserver, /ota_stack_absent_at_done/);
const rebootWait = section(gate, "def wait_for_new_firmware(", "\ndef wait_for_bench_health_window(");
assert.match(rebootWait, /request_json_deadline\([\s\S]{0,100}?"\/ota\/status"/);
assert.match(rebootWait, /request_status_deadline\([\s\S]{0,100}?status_endpoint/);
assert.doesNotMatch(rebootWait, /request_json\(host,\s*"\/status"\)/,
  "post-write identity must remain on the prevalidated endpoint");
assert.match(rebootWait, /except \(CompactTransportError, OSError, TimeoutError\):/);
assert.match(rebootWait, /record_ota_transfer_evidence\(ota, ota_evidence\)/);
assert.doesNotMatch(rebootWait, /JSONDecodeError/,
  "complete malformed JSON must remain a hard failure");
const identityWait = section(gate, "def wait_for_identity(", "\ndef wait_for_ota_image_state(");
assert.match(identityWait, /endpoint\s*=\s*resolve_http_endpoint\(host\)/,
  "each post-cycle identity attempt must resolve and pin one endpoint");
assert.match(identityWait,
  /request_status_deadline\([\s\S]{0,120}?endpoint, timeout=min\(remaining, HTTP_TIMEOUT_S\)/,
  "post-cycle status must consume the remaining whole-attempt deadline");
assert.doesNotMatch(identityWait, /request_json\(|request_bytes\(/,
  "post-cycle identity must never fall back to an unbounded status reader");
const healthWait = section(
  gate, "def wait_for_bench_health_window(", "\ndef wait_for_legacy_offer(",
);
assert.match(healthWait, /endpoint\s*=\s*resolve_http_endpoint\(host\)/);
assert.match(healthWait,
  /request_status_deadline\([\s\S]{0,120}?timeout=min\(remaining, HTTP_TIMEOUT_S\)/);
assert.doesNotMatch(healthWait, /request_json\(|request_bytes\(/,
  "release-HIL health dwell must use bounded status reads");
const transferEvidence = section(
  gate, "def require_ota_transfer_evidence(", "\ndef install_bench_target(",
);
assert.match(transferEvidence, /ota_stack_min_free_bytes/);
assert.match(transferEvidence, /ota_stack\s*<\s*1024/,
  "every accepted current-image OTA must retain at least 1 KiB task stack");
assert.match(transferEvidence,
  /phase == "bench target"[\s\S]{0,300}?not stack_present_at_done[\s\S]{0,160}?stack_absent_at_done[\s\S]{0,160}?ota_stack is None[\s\S]{0,220}?writer_version, writer_elf[\s\S]{0,220}?LEGACY_RELEASE_VERSION, LEGACY_RELEASE_ELF_ID/,
  "only the exact historical writer may omit an OTA-task stack field");
assert.match(transferEvidence,
  /and\s+\\[\s\S]{0,80}?not legacy_writer_without_stack/,
  "a numeric legacy stack measurement below the floor must still fail");

// Exact offer/write and production ordering.
assert.match(gate,
  /def post_update_once\([\s\S]{0,1800}?"after": check_generation[\s\S]{0,300}?"channel": expected_channel[\s\S]{0,300}?"version": expected_version[\s\S]{0,300}?"sha256": expected_app_sha256/);
assert.match(gate, /expected_generation\s*=\s*1 if check_generation == 0xFFFFFFFF else check_generation \+ 1/);
assert.match(gate, /did not settle on the exact gated artifact within \{OTA_CHECK_TIMEOUT_S\} seconds/);
assert.match(httpOta, /available_sha256[\s\S]{0,180}?available_channel/);
assert.equal(occurrences(httpOta, "503 Service Unavailable"), 2);

const production = gate.slice(gate.indexOf("if args.confirm_production != PRODUCTION_ROLE"));
assert.equal(occurrences(production, "post_update_once("), 1,
  "production execution must contain exactly one update write");
assert.doesNotMatch(production, /set_update_channel|legacy bench/);
const prodResolve = production.indexOf("production_status_endpoint = resolve_http_endpoint(");
const prodIdentity = production.indexOf("validate_identity(", prodResolve);
const prodReadiness = production.indexOf(
  "production_before = wait_for_production_promotion_readiness(", prodIdentity,
);
const prodOffer = production.indexOf("check_generation = wait_for_ota_offer(", prodReadiness);
const prodPost = production.indexOf("post_update_once(", prodOffer);
const prodReturn = production.indexOf("wait_for_new_firmware(", prodPost);
const prodStress = production.indexOf("production_evidence = stress_board(", prodReturn);
const finalIdentity = production.indexOf("validate_identity(", prodStress);
const retained = production.indexOf("verify_retained_x10a(final_status)", finalIdentity);
assert.ok(prodResolve >= 0 && prodIdentity > prodResolve && prodReadiness > prodIdentity &&
  prodOffer > prodReadiness &&
  prodPost > prodOffer && prodReturn > prodPost && prodStress > prodReturn &&
  finalIdentity > prodStress && retained > finalIdentity,
  "production must preserve resolve/identity/readiness/offer/write/reboot/stress/final-identity/X10A order");

// Release-HIL feed, bootstrap, persistence and hard-cancel boundaries.
assert.match(gate, /RELEASE_HIL_POLICY_PATH\s*=\s*Path\("\/etc\/daikin-altherma-esp32\/release-hil-policy\.json"\)/);
assert.match(gate, /release-HIL root policy must be schema_version 3/);
assert.match(gate, /release-HIL inventory must be a schema_version 3 object/);
const inventoryLoader = section(
  gate, "def load_release_hil_inventory(", "\ndef run_checked(",
);
assert.match(inventoryLoader,
  /allowed_tasks\s*=\s*\{[^}]*"weather"[^}]*\}[\s\S]*?if lab\["require_weather"\]:[\s\S]*?required_tasks\.add\("weather"\)/,
  "a mandatory Weather stress run must make Weather stack evidence mandatory too");
const stackEvidence = section(
  gate, "def require_stack_evidence(", "\n\nclass NoRedirect",
);
assert.match(stackEvidence, /for task in tasks:[\s\S]*?value = stack\.get\(task\)[\s\S]*?value < minimum/,
  "every inventory-required stack, including Weather, must meet the live floor");
const policyLoader = section(
  gate, "def load_release_hil_policy(", "\ndef load_release_hil_inventory(",
);
const policyFields = section(policyLoader, "fields = {", "\n    }");
for (const field of ["bootstrap_version", "bootstrap_elf", "bootstrap_app_sha256",
  "bootstrap_manifest_url", "bootstrap_firmware_base_url", "manifest_url",
  "firmware_base_url", "feed_controller_id", "power_controller_id", "power_outlet"]) {
  assert.match(policyFields, new RegExp(`"${field}"`), `release-HIL policy must bind ${field}`);
}
assert.match(httpOta, /effective_manifest_url/);
assert.match(httpOta, /effective_firmware_base_url/);
assert.match(httpOta, /X-Daikin-HIL-Manifest-URL/);
assert.match(httpOta, /X-Daikin-HIL-Firmware-Base-URL/);
const hilHeaders = section(gate, "def release_hil_request_headers(", "\ndef load_release_hil_policy(");
assert.match(hilHeaders, /HIL_MANIFEST_HEADER/);
assert.match(hilHeaders, /HIL_FIRMWARE_BASE_HEADER/);
assert.match(gate, /extra_headers=hil_headers/);
assert.match(gate, /status\.get\("effective_manifest_url"\)\s*!=\s*expected_manifest_url[\s\S]{0,180}?status\.get\("effective_firmware_base_url"\)\s*!=\s*expected_firmware_base_url/);
assert.match(otaHilFeed, /struct OtaOfferBinding[\s\S]{0,500}?uint32_t\s+generation[\s\S]{0,500}?OtaFeedUrls\s+feed/);
assert.match(otaHilFeed, /ota_offer_binding_copy_feed\([\s\S]{0,900}?binding\.generation\s*!=\s*generation[\s\S]{0,500}?binding\.feed/);
assert.match(gate,
  /old_version\s*!=\s*lab\["bootstrap_version"\][\s\S]{0,160}?old_elf\s*!=\s*lab\["bootstrap_elf"\]/);
assert.match(gate,
  /require_exact_release_hil_feed\([\s\S]{0,180}?lab\["manifest_url"\][\s\S]{0,120}?lab\["firmware_base_url"\]/);
const bootstrapVerifier = section(
  gate, "def verify_release_hil_bootstrap_artifact(", "\ndef require_release_hil_channel(",
);
assert.match(bootstrapVerifier, /bootstrap_app_sha256/);
assert.match(bootstrapVerifier, /candidates\s*!=\s*\["daikin-altherma-esp32\.bin"\]/);
assert.match(bootstrapVerifier, /hashlib\.sha256\(app\)\.hexdigest\(\)/);
assert.match(bootstrapVerifier, /verify_image\(app,[\s\S]{0,100}?bootstrap_version/);
assert.match(bootstrapVerifier, /elf\s*!=\s*lab\["bootstrap_elf"\]/);
assert.match(bootstrapVerifier, /verify_http_range_support\(app_url, app\)/);
assert.match(gate, /persistence_canaries[\s\S]{0,500}?"mqtt\.base"[\s\S]{0,120}?"mqtt\.base_custom"/);
assert.match(gate, /history[\s\S]{0,100}?persist[\s\S]{0,100}?power_cycle/);

const controllerTransport = section(gate, "def control_json(", "\ndef validate_feed_lease(");
assert.match(controllerTransport, /method not in \("GET", "POST", "DELETE"\)/,
  "the controller method allowlist must admit the watchdog status GET");
assert.match(controllerTransport, /if method == "GET" and payload is not None:/,
  "controller GET requests must reject every entity payload");
assert.match(controllerTransport, /if method != "GET" and not isinstance\(payload, dict\):/,
  "mutating controller requests must retain an explicit object payload");
assert.match(controllerTransport,
  /if method != "GET":[\s\S]{0,220}?Content-Type: application\/json[\s\S]{0,120}?Content-Length:/,
  "GET requests must omit entity headers as well as entity bytes");

const commitWindow = Number(ota.match(/kHealthBaseWindowS\s*=\s*(\d+)/)?.[1]);
const watchdogTtl = Number(gate.match(/PENDING_IMAGE_WATCHDOG_TTL_S\s*=\s*(\d+)/)?.[1]);
assert.ok(watchdogTtl > 0 && watchdogTtl < commitWindow,
  "the non-renewable rollback deadline must expire before PENDING_VERIFY can commit");
const watchdog = section(gate, "def pending_image_power_watchdog(", "\ndef wait_for_identity(");
assert.match(watchdog, /cycle-watchdogs/);
assert.doesNotMatch(watchdog, /\/renew/,
  "a sliding renewal could extend the recovery cycle beyond the commit boundary");
assert.match(watchdog, /\/trigger/);
assert.match(watchdog, /\/release/);
assert.match(watchdog, /if not triggered and not released:[\s\S]{0,900}?emergency trigger/);
const install = section(gate, "def release_hil_install_once(", "\ndef run_release_hil(");
assert.equal(occurrences(install, "allow_downgrade=allow_downgrade"), 2,
  "the exact offer and its sole write must share the downgrade decision");
const pendingWitness = install.indexOf(
  "pending = wait_for_ota_image_state(endpoint, rollback_pending=True)",
);
const freshStatus = install.indexOf(
  "post_witness_status = request_status_deadline(endpoint, timeout=HTTP_TIMEOUT_S)",
  pendingWitness,
);
const freshIdentity = install.indexOf("validate_identity(", freshStatus);
const freshChannel = install.indexOf(
  "require_release_hil_channel(post_witness_status, channel)", freshIdentity,
);
const freshReturn = install.indexOf("return post_witness_status, transfer", freshChannel);
assert.ok(pendingWitness >= 0 && freshStatus > pendingWitness && freshIdentity > freshStatus &&
  freshChannel > freshIdentity && freshReturn > freshChannel,
  "the 45-second decision must consume an exact post-pending-witness status snapshot");
const hil = section(gate, "def run_release_hil(", "\ndef self_test(");
assert.match(hil, /bootstrap_artifact\s*=\s*verify_release_hil_bootstrap_artifact\(lab\)/);
assert.doesNotMatch(hil, /request_json\(host,\s*"\/status"\)/,
  "release-HIL bootstrap/final identity must use bounded status reads");
assert.match(hil,
  /initial_endpoint\s*=\s*resolve_http_endpoint\(host\)[\s\S]{0,100}?before\s*=\s*request_status_deadline\(initial_endpoint, timeout=HTTP_TIMEOUT_S\)/);
assert.match(hil,
  /final_endpoint\s*=\s*resolve_http_endpoint\(host\)[\s\S]{0,100}?final\s*=\s*request_status_deadline\(final_endpoint, timeout=HTTP_TIMEOUT_S\)/);
const watchdogArm = hil.indexOf("with pending_image_power_watchdog(");
const firstInstall = hil.indexOf("first_status, first_transfer = release_hil_install_once(", watchdogArm);
const firstUptime = hil.indexOf("required_uptime(first_status", firstInstall);
const firstActive = hil.indexOf("require_watchdog_active()", firstInstall);
const watchdogTrigger = hil.indexOf("trigger_watchdog_cycle()", firstActive);
const rollbackWait = hil.indexOf("rolled_back = wait_for_identity(", watchdogTrigger);
assert.ok(watchdogArm >= 0 && firstInstall > watchdogArm && firstUptime > firstInstall &&
  firstActive > firstUptime && watchdogTrigger > firstActive && rollbackWait > watchdogTrigger,
  "watchdog must arm before the first write and own the intentional rollback cycle");
const secondWatchdog = hil.indexOf("with pending_image_power_watchdog(", watchdogArm + 1);
const secondInstall = hil.indexOf("second_status, second_transfer = release_hil_install_once(", secondWatchdog);
const secondUptime = hil.indexOf("required_uptime(second_status", secondInstall);
const secondActive = hil.indexOf("require_commit_watchdog_active()", secondInstall);
const approval = hil.indexOf("approve_commit_candidate()", secondActive);
const healthWindow = hil.indexOf("health = wait_for_bench_health_window(", approval);
const committedValid = hil.indexOf(
  "wait_for_ota_image_state(committed_endpoint, rollback_pending=False)", healthWindow,
);
const committedColdCycle = hil.indexOf("release_hil_power_cycle(lab, power_token)", committedValid);
assert.ok(secondWatchdog > rollbackWait && secondInstall > secondWatchdog &&
  secondUptime > secondInstall && secondActive > secondUptime && approval > secondActive &&
  healthWindow > approval && committedValid > healthWindow && committedColdCycle > committedValid,
  "phase 2 must explicitly release the hard watchdog before commit and cold-cycle only after valid");
const thirdWatchdog = hil.indexOf("with pending_image_power_watchdog(", secondWatchdog + 1);
const writerInstall = hil.indexOf(
  "bootstrap_status, candidate_writer_transfer = release_hil_install_once(", thirdWatchdog,
);
const writerCallEnd = hil.indexOf("\n            )", writerInstall);
const writerCall = hil.slice(writerInstall, writerCallEnd);
assert.match(writerCall, /host=host,\s*mac=mac,\s*current_version=version,\s*current_elf=elf/);
assert.match(writerCall, /version=lab\["bootstrap_version"\]/);
assert.match(writerCall,
  /app_sha256=lab\["bootstrap_app_sha256"\],\s*elf=lab\["bootstrap_elf"\]/);
assert.match(writerCall, /channel=lab\["channel"\]/);
assert.match(writerCall, /manifest_url=lab\["bootstrap_manifest_url"\]/);
assert.match(writerCall, /firmware_base_url=lab\["bootstrap_firmware_base_url"\]/);
assert.match(writerCall, /allow_downgrade=True/);
const writerDowngrade = hil.indexOf("allow_downgrade=True", writerInstall);
const writerUptime = hil.indexOf("required_uptime(", writerDowngrade);
const writerActive = hil.indexOf("require_writer_watchdog_active()", writerUptime);
const writerTrigger = hil.indexOf("trigger_writer_watchdog_cycle()", writerActive);
const writerRollback = hil.indexOf("writer_rollback = wait_for_identity(", writerTrigger);
const writerIdentity = hil.indexOf("validate_identity(writer_pinned", writerRollback);
const writerValid = hil.indexOf(
  "writer_image_state = wait_for_ota_image_state(", writerIdentity,
);
const finalStress = hil.indexOf("stress = stress_board(", writerValid);
assert.ok(thirdWatchdog > committedColdCycle && writerInstall > thirdWatchdog &&
  writerCallEnd > writerInstall &&
  writerDowngrade > writerInstall && writerUptime > writerDowngrade &&
  writerActive > writerUptime && writerTrigger > writerActive && writerRollback > writerTrigger &&
  writerIdentity > writerRollback && writerValid > writerIdentity && finalStress > writerValid,
  "the valid candidate must write a pinned bootstrap and roll back to itself before final stress");
assert.match(hil,
  /writer_image_state\s*=\s*wait_for_ota_image_state\([\s\S]{0,100}?writer_endpoint, rollback_pending=False/);

// Firmware-side non-persistent weather trigger and rollback health proof.
const setWeather = section(httpConfig, "static esp_err_t set_weather(", "\n// POST /set_board");
assert.match(setWeather, /const bool refresh\s*=\s*cJSON_IsTrue\(refresh_item\)/);
assert.match(setWeather, /const bool unchanged\s*=\s*location\.enabled\s*==\s*c\.weather_enabled[\s\S]*?location\.latitude_e6\s*==\s*c\.weather_latitude_e6[\s\S]*?location\.longitude_e6\s*==\s*c\.weather_longitude_e6/);
const refreshBranch = section(setWeather, "if (refresh) {", "\n    if (unchanged)");
assert.match(refreshBranch, /if \(!unchanged \|\| !location\.enabled\)/);
assert.match(refreshBranch,
  /!c\.diagnostics_enabled[\s\S]{0,180}?409 Conflict[\s\S]{0,260}?!weather_forecast_request_refresh\(refresh_token\)[\s\S]{0,220}?503 Service Unavailable/,
  "refresh must refuse without diagnostics consent and without an actual Weather task");
assert.doesNotMatch(refreshBranch, /config_save\(/);
assert.match(refreshBranch,
  /refresh_token = 0[\s\S]*?\\"saved\\":false,[\s\S]*?\\"refresh_requested\\":true,[\s\S]*?\\"refresh_token\\":%llu/,
  "the non-persistent POST must return the exact accepted causal token");
assert.match(weatherHeader,
  /uint64_t refresh_requested_token\s*=\s*0, refresh_started_token\s*=\s*0,[\s\S]*?refresh_completed_token\s*=\s*0,[\s\S]*?refresh_success_token\s*=\s*0/);
const refreshClaim = section(weatherSource, "uint64_t claim_refresh_request_locked()", "\n}\n\nvoid complete_refresh_request");
assert.match(refreshClaim,
  /weather_refresh_claim\(s_refresh_requested_token, s_refresh_completed_token,[\s\S]*?s_refresh_started_token\)/);
const refreshComplete = section(weatherSource, "void complete_refresh_request(",
  "\n}\n\nbool defer_refresh_request");
assert.match(refreshComplete,
  /weather_refresh_complete\(s_refresh_requested_token, s_refresh_started_token, token,[\s\S]*?success, s_refresh_completed_token, s_refresh_success_token\)/,
  "firmware refresh completion must use the tested first-wins state transition");
assert.match(weatherLogic,
  /weather_refresh_complete\([\s\S]*?completed_token == token[\s\S]*?return false;[\s\S]*?if \(success\) success_token = token;[\s\S]*?completed_token = token/,
  "a source-change cancellation must be final against the old attempt's late success finish");
const refreshDefer = section(weatherSource, "bool defer_refresh_request(",
  "\n}\n\n// Defaults to fail-closed completion");
assert.match(refreshDefer,
  /weather_refresh_defer\(s_refresh_requested_token, s_refresh_started_token, token,[\s\S]*?s_refresh_completed_token\)/,
  "firmware OTA deferral must use the tested exact-token state transition");
assert.match(weatherLogic,
  /weather_refresh_defer\([\s\S]*?token != 0[\s\S]*?requested_token == token[\s\S]*?started_token == token[\s\S]*?completed_token != token/,
  "OTA deferral must accept only the still-outstanding exact refresh token");
const weatherTask = section(weatherSource, "void weather_task(void*)", "\n}\n\n}  // namespace");
const fetchAdmission = section(weatherTask, "time_now(now, ms);", "WeatherForecastSample sample;");
const admissionLock = fetchAdmission.indexOf("Lock lk(s_mtx)");
const admissionClaim = fetchAdmission.indexOf("claim_refresh_request_locked()", admissionLock);
const admissionDrain = fetchAdmission.indexOf("ulTaskNotifyTake(pdTRUE, 0)", admissionClaim);
const admissionFetching = fetchAdmission.indexOf("s_status.fetching = true", admissionDrain);
assert.ok(admissionLock >= 0 && admissionClaim > admissionLock && admissionDrain > admissionClaim &&
          admissionFetching > admissionDrain,
  "the task must claim a request in the same lock that starts its exact fetch attempt");
assert.match(fetchAdmission,
  /if \(refresh_attempt\.token != 0\) ulTaskNotifyTake\(pdTRUE, 0\);/,
  "a natural cycle that claims the request must consume its now-redundant queued wake");
assert.match(weatherTask,
  /RefreshRequestAttempt refresh_attempt[\s\S]*?refresh_attempt\.finish\(updated\)/,
  "only the real forecast update commit may complete an explicit refresh successfully");
assert.match(weatherSource,
  /~RefreshRequestAttempt\(\) noexcept \{ finish\(false\); \}/,
  "the attempt guard must fail-complete every path that was not explicitly deferred");
const otaPreempted = section(weatherTask, "if (ota_preempted) {",
  "\n            if (poll_quiesce_failed");
assert.match(otaPreempted,
  /refresh_attempt\.defer\(\)[\s\S]*?ulTaskNotifyTake\(pdTRUE, pdMS_TO_TICKS\(1000\)\)[\s\S]*?continue;/,
  "OTA serialization must leave the exact refresh token pending for reclaim");
assert.doesNotMatch(otaPreempted, /refresh_attempt\.finish\(false\)/,
  "OTA serialization must not fail-complete the causal refresh token");
assert.match(weatherSource,
  /WeatherSourceChange::commit\(\) noexcept[\s\S]*?weather_refresh_cancel_outstanding\(s_refresh_requested_token,[\s\S]*?s_refresh_completed_token\)/,
  "a source or consent replacement must cancel an unclaimed refresh token");
const refreshRequest = section(weatherSource,
  "bool weather_forecast_request_refresh(uint64_t& token) noexcept", "\n}\n\nWeatherForecastStatus");
const refreshRequestLockStart = refreshRequest.indexOf("    {\n        Lock lk(s_mtx);");
const refreshRequestLockEnd = refreshRequest.indexOf("\n    }\n    return true;", refreshRequestLockStart);
const refreshRequestLock = refreshRequest.slice(refreshRequestLockStart, refreshRequestLockEnd);
assert.ok(refreshRequestLockStart >= 0 && refreshRequestLockEnd > refreshRequestLockStart,
  "the refresh request mutex transaction must remain identifiable");
assert.match(refreshRequestLock,
  /Lock lk\(s_mtx\)[\s\S]*?task\s*=\s*s_task\.load\(std::memory_order_acquire\)[\s\S]*?if \(!task[\s\S]*?s_refresh_requested_token\s*=\s*s_refresh_next_token[\s\S]*?token\s*=\s*s_refresh_requested_token[\s\S]*?xTaskNotifyGive\(task\)/,
  "the acquire-loaded task handle, token publication and wake must share s_mtx so task-side coalescing cannot race a late Give");
for (const field of ["requested", "started", "completed", "success"]) {
  assert.match(httpStatus, new RegExp(`\\\\"refresh_${field}_token\\\\":`),
    `/status must expose the ${field} token for causal HIL evidence`);
}
const saveWeather = section(setWeather, "if (unchanged)", "\n}");
const weatherBegin = saveWeather.indexOf(
  "WeatherSourceChange weather_change(location.enabled, c.diagnostics_enabled)");
const weatherSave = saveWeather.indexOf("config_save(c)");
const weatherInvalidate = saveWeather.indexOf("weather_change.commit()", weatherSave);
const weatherCleanup = saveWeather.indexOf("mqtt_request_weather_cleanup()", weatherInvalidate);
const weatherAck = saveWeather.indexOf('"saved\\":true', weatherCleanup);
assert.ok(weatherBegin >= 0 && weatherSave > weatherBegin && weatherInvalidate > weatherSave &&
  weatherCleanup > weatherInvalidate && weatherAck > weatherCleanup,
  "a saved Weather source must invalidate old values and retained MQTT before acknowledging it");
assert.match(health, /OTA_HEALTH_MIN_FREE_BYTES\s*=\s*24u\s*\*\s*1024u/);
assert.match(health, /OTA_HEALTH_MIN_LARGEST_BLOCK_BYTES\s*=\s*16u\s*\*\s*1024u/);
assert.match(health, /!service\.allocation_failures/);
assert.match(mqtt, /s_x10a_publish_proven\.store\(true,\s*std::memory_order_release\)/);
assert.match(ota, /HealthVerdict::GiveUp[\s\S]{0,700}?esp_restart\(\);/);

// CI trust split and agent mutation guard remain explicit.
assert.match(workflow, /release_hil:[\s\S]{0,500}?runs-on:\s*\[self-hosted, daikin-release-lab\]/);
assert.match(workflow, /release_hil:[\s\S]{0,1600}?contents:\s*read/);
assert.match(workflow, /publish:[\s\S]{0,100}?needs:\s*\[trusted_build, release_hil\]/);
assert.match(workflow, /RELEASE_HIL_POWER_TOKEN:[\s\S]{0,120}?RELEASE_HIL_FEED_TOKEN:/);
assert.match(hook, /direct OTA writes are forbidden; run scripts\/production-ota-gate\.py/);
assert.match(hook, /canonical_production_ota_command/);

console.log("OTA gate: transport, exact artifact, HIL feed, rollback and cancel boundaries pinned");
