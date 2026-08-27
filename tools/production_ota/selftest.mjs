#!/usr/bin/env node
// Mutation-test the production OTA source contracts in an isolated throwaway tree.  The board,
// controller, network and signing key are never contacted.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const centralContract = path.join(root, "test/test_production_ota_gate_contract.mjs");
const files = [
  "scripts/production-ota-gate.py",
  "tools/agent-hooks/agent_hook.py",
  "main/logic/health_gate.hpp",
  "main/logic/ota_hil_feed.hpp",
  "main/logic/ota_quiesce.hpp",
  "main/ota_update.cpp",
  "main/http_ota.cpp",
  "main/http_config.cpp",
  "main/http_status.cpp",
  "main/weather_forecast.cpp",
  "main/weather_forecast.hpp",
  "main/logic/weather_forecast.hpp",
  "main/stack_watch.hpp",
  "main/logic/heartbeat.hpp",
  "main/mqtt_ha.cpp",
  ".github/workflows/build.yml",
];
const pristine = new Map(files.map(rel => [rel, fs.readFileSync(path.join(root, rel), "utf8")]));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "daikin-production-ota-contract-"));

const restore = () => {
  for (const [rel, contents] of pristine) {
    const target = path.join(tmp, rel);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, contents);
  }
};

const replaceOnce = (rel, before, after) => {
  const target = path.join(tmp, rel);
  const old = fs.readFileSync(target, "utf8");
  const changed = old.replace(before, after);
  assert.notEqual(changed, old, `mutation no longer reaches ${rel}: ${String(before)}`);
  fs.writeFileSync(target, changed);
};

const replaceNth = (rel, before, after, wanted) => {
  assert.ok(typeof before === "string" && before.length > 0);
  const target = path.join(tmp, rel);
  const old = fs.readFileSync(target, "utf8");
  let offset = 0;
  let found = -1;
  for (let current = 1; current <= wanted; current++) {
    found = old.indexOf(before, offset);
    assert.ok(found >= 0, `mutation no longer reaches occurrence ${wanted} in ${rel}: ${before}`);
    offset = found + before.length;
  }
  const changed = old.slice(0, found) + after + old.slice(found + before.length);
  fs.writeFileSync(target, changed);
};

const readTmp = rel => fs.readFileSync(path.join(tmp, rel), "utf8");
const section = (text, start, end) => {
  const first = text.indexOf(start);
  const last = text.indexOf(end, first + start.length);
  assert.ok(first >= 0 && last > first, `missing source section ${start}`);
  return text.slice(first, last);
};

// These assertions supplement the central contract with narrow implementation boundaries whose
// removal used to pass shape-only review.  Every seeded mutation below must fail at least one
// executable contract.
const supplementalContract = () => {
  const gate = readTmp("scripts/production-ota-gate.py");
  const httpOta = readTmp("main/http_ota.cpp");
  const feed = readTmp("main/logic/ota_hil_feed.hpp");

  const transport = section(gate, "def read_bounded_http_response(", "\ndef verify_http_range_support(");
  assert.match(transport, /transfer_encodings\[0\]\s*!=\s*b"chunked"/);
  assert.match(transport, /re\.fullmatch\(rb"\[0-9A-Fa-f\]\+", size_text\)/);
  assert.match(transport, /chunk_size\s*>\s*max_body_bytes\s*-\s*len\(body\)/);
  assert.match(transport, /trailers or bytes after its terminator/);
  assert.match(transport, /if status < 200 or status >= 300:\s*\n\s*raise HTTPError/);
  assert.ok(
    transport.indexOf("if status < 200 or status >= 300:") >
      transport.indexOf("chunked HTTP response has trailers or bytes after its terminator"),
    "HTTP 503 may be classified only after complete strict framing",
  );

  const pressureFailure = section(
    gate, "def record_bench_pressure_failure(", "\ndef exercise_bench_full_download(",
  );
  assert.match(pressureFailure, /isinstance\(error, HTTPError\)[\s\S]*?error\.code == 503/);
  assert.match(pressureFailure, /isinstance\(error, \(CompactTransportError, OSError, TimeoutError\)\)/);
  assert.match(pressureFailure, /unexpected\.append/);
  const fullDownload = section(
    gate, "def exercise_bench_full_download(", "\ndef require_ota_transfer_evidence(",
  );
  assert.match(fullDownload, /except BaseException as error:/);
  assert.match(fullDownload, /if kind == "status":\s*\n\s*request_status_deadline\(status_endpoint/);
  assert.match(fullDownload, /elif kind == "values":\s*\n\s*request_values_deadline\(status_endpoint/);
  assert.match(fullDownload, /record_bench_pressure_failure\(kind, error, counts, unexpected, lock\)/);
  assert.match(fullDownload, /worker\.join[\s\S]*?worker\.is_alive\(\)/);
  assert.match(fullDownload, /if unexpected:[\s\S]*?fail\(/);
  assert.equal((fullDownload.match(/require_official_dev_manifest_snapshot\(/g) || []).length, 2);
  assert.match(fullDownload,
    /wait_for_ota_offer\([\s\S]{0,260}?expected_channel="dev"[\s\S]{0,220}?hil_manifest_url=OFFICIAL_RELEASE_MANIFEST_URL[\s\S]{0,160}?hil_firmware_base_url=OFFICIAL_RELEASE_FIRMWARE_BASE_URL/);
  assert.match(fullDownload,
    /post_update_once\([\s\S]{0,180}?expected_channel="dev"[\s\S]{0,80}?allow_downgrade=True/);
  assert.doesNotMatch(fullDownload, /set_update_channel/);
  const limitedRemoteDocument = section(
    gate, "def request_limited_bytes(", "\ndef request_json(",
  );
  assert.match(limitedRemoteDocument,
    /threading\.Thread\([\s\S]{0,140}?daemon=True\)\.start\(\)/);
  assert.match(limitedRemoteDocument, /if not completed\.wait\(timeout\):/);
  const rebootWait = section(gate, "def wait_for_new_firmware(", "\ndef wait_for_bench_health_window(");
  assert.match(rebootWait, /\("ota_stack_min_free_bytes",\s*"ota_stack_min_free_bytes"\)/);
  const identityWait = section(
    gate, "def wait_for_identity(", "\ndef wait_for_ota_image_state(",
  );
  assert.match(identityWait, /endpoint\s*=\s*resolve_http_endpoint\(host\)/);
  assert.match(identityWait,
    /request_status_deadline\([\s\S]{0,120}?timeout=min\(remaining, HTTP_TIMEOUT_S\)/);
  assert.doesNotMatch(identityWait, /request_json\(|request_bytes\(/);
  const healthWait = section(
    gate, "def wait_for_bench_health_window(", "\ndef wait_for_legacy_offer(",
  );
  assert.match(healthWait, /request_status_deadline\([\s\S]{0,140}?timeout=min\(remaining, HTTP_TIMEOUT_S\)/);
  assert.doesNotMatch(healthWait, /request_json\(|request_bytes\(/);
  const transferEvidence = section(
    gate, "def require_ota_transfer_evidence(", "\ndef install_bench_target(",
  );
  assert.match(transferEvidence, /ota_stack\s*<\s*1024/);

  const controller = section(gate, "def control_json(", "\ndef validate_feed_lease(");
  assert.match(controller, /method not in \("GET", "POST", "DELETE"\)/);
  assert.match(controller, /if method == "GET" and payload is not None:/);
  assert.match(controller, /if method != "GET" and not isinstance\(payload, dict\):/);
  assert.match(controller,
    /if method != "GET":[\s\S]{0,220}?Content-Type: application\/json[\s\S]{0,120}?Content-Length:/);
  assert.match(controller, /deadline\s*=\s*time\.monotonic\(\) \+ HTTP_TIMEOUT_S/);
  assert.match(controller, /def remaining\(\)/);
  assert.match(controller, /resolution_done\.wait\(remaining\(\)\)/);
  assert.match(controller, /candidate\.settimeout\(remaining\(\)\)[\s\S]*?candidate\.connect\(sockaddr\)/);
  assert.match(controller, /wrap_socket\([\s\S]*?server_hostname=parsed\.hostname,[\s\S]*?do_handshake_on_connect=False/);
  assert.match(controller, /tls_socket\.settimeout\(remaining\(\)\)\s*\n\s*tls_socket\.do_handshake\(\)/);
  assert.match(controller, /read_bounded_http_response\([\s\S]*?deadline,[\s\S]*?allow_chunked=True/);

  const canonical = section(gate, "def canonical_https_url(", "\ndef load_release_hil_policy(");
  for (const guard of [
    "parsed.port is not None", '"%" in parsed.path', '"//" in parsed.path',
    'any(segment in (".", "..") for segment in parsed.path.split("/"))',
    "parsed.query", "parsed.fragment",
  ]) assert.ok(canonical.includes(guard), `canonical HTTPS URL guard missing: ${guard}`);
  assert.match(canonical, /not parsed\.path\.startswith\(base\.path\)/);

  assert.match(gate, /release-HIL root policy must be schema_version 3/);
  assert.match(gate, /release-HIL inventory must be a schema_version 3 object/);
  const policyLoader = section(
    gate, "def load_release_hil_policy(", "\ndef load_release_hil_inventory(",
  );
  const policyFields = section(policyLoader, "fields = {", "\n    }");
  for (const field of [
    "bootstrap_version", "bootstrap_elf", "bootstrap_app_sha256",
    "bootstrap_manifest_url", "bootstrap_firmware_base_url",
  ]) assert.match(policyFields, new RegExp(`"${field}"`));

  const hilHeaders = section(gate, "def release_hil_request_headers(", "\ndef load_release_hil_policy(");
  assert.match(hilHeaders, /HIL_MANIFEST_HEADER:\s*manifest_url/);
  assert.match(hilHeaders, /HIL_FIRMWARE_BASE_HEADER:\s*firmware_base_url/);
  const boundedRequest = section(gate, "def request_bytes_deadline(", "\ndef request_json_deadline(");
  assert.match(boundedRequest, /set\(extra_headers\)\s*!=\s*HIL_FEED_HEADERS/);
  assert.match(boundedRequest, /method\s*!=\s*"GET"/);
  assert.match(boundedRequest, /not path\.startswith\("\/ota\/check\?"\)/);
  const offer = section(gate, "def ota_offer_ready(", "\ndef post_update_once(");
  assert.match(offer, /extra_headers=hil_headers/);
  assert.match(offer, /status\.get\("effective_manifest_url"\)\s*!=\s*expected_manifest_url/);
  assert.match(offer, /status\.get\("effective_firmware_base_url"\)\s*!=\s*expected_firmware_base_url/);
  assert.match(offer, /status\.get\("available_sha256"\)\s*!=\s*expected_app_sha256/);
  assert.match(offer, /status\.get\("available_channel"\)\s*!=\s*expected_channel/);
  assert.match(offer, /generation\s*!=\s*expected_generation/);
  const stress = section(gate, "def stress_board(", "\ndef verify_retained_x10a(");
  assert.match(stress, /request_json_deadline\([\s\S]{0,260}?"\/ota\/check\?ms=[\s\S]{0,220}?extra_headers=hil_headers/);
  assert.match(stress, /require_stress_ota_offer\([\s\S]{0,260}?manifest_url=hil_manifest_url[\s\S]{0,120}?firmware_base_url=hil_firmware_base_url/);
  const feedLease = section(gate, "def validate_feed_lease(", "\n@contextmanager\ndef leased_release_hil_feed(");
  assert.match(feedLease, /result\.get\("manifest_url"\)\s*!=\s*manifest_url/);
  assert.match(feedLease, /result\.get\("firmware_base_url"\)\s*!=\s*firmware_base_url/);
  const bootstrapVerifier = section(
    gate, "def verify_release_hil_bootstrap_artifact(", "\ndef require_release_hil_channel(",
  );
  assert.match(bootstrapVerifier, /bootstrap_app_sha256/);
  assert.match(bootstrapVerifier, /hashlib\.sha256\(app\)\.hexdigest\(\)/);
  assert.match(bootstrapVerifier, /verify_image\(app,/);
  assert.match(bootstrapVerifier, /verify_http_range_support\(app_url, app\)/);

  assert.match(httpOta, /X-Daikin-HIL-Manifest-URL/);
  assert.match(httpOta, /X-Daikin-HIL-Firmware-Base-URL/);
  assert.match(httpOta, /OtaHilFeedHeaderResult::PartialPair/);
  assert.match(httpOta, /OtaHilFeedHeaderResult::InvalidUrl/);
  assert.match(httpOta, /ota_check_async\(ms, override_feed\)/);
  assert.match(httpOta, /effective_manifest_url/);
  assert.match(httpOta, /effective_firmware_base_url/);
  assert.ok(httpOta.includes('j += ",\\"image_state\\":"'));
  assert.ok(httpOta.includes('j += ",\\"rollback_pending\\":"'));
  assert.match(feed, /binding\.generation != generation/);
  assert.match(feed, /bound_channel != channel/);
  assert.match(feed, /bound_version != version/);
  assert.match(feed, /std::memcmp\(binding\.app_sha256/);
  assert.match(feed, /out\s*=\s*binding\.feed/);

  const hil = section(gate, "def run_release_hil(", "\ndef self_test(");
  assert.match(hil, /bootstrap_artifact\s*=\s*verify_release_hil_bootstrap_artifact\(lab\)/);
  assert.equal((hil.match(/with pending_image_power_watchdog\(/g) || []).length, 3,
    "both candidate installs and the candidate-writer rollback need hard watchdogs");
  assert.doesNotMatch(hil, /request_json\(host,\s*"\/status"\)/);
  assert.match(hil, /before\s*=\s*request_status_deadline\(initial_endpoint/);
  assert.match(hil, /final\s*=\s*request_status_deadline\(final_endpoint/);
  const firstWatchdog = hil.indexOf("with pending_image_power_watchdog(");
  const firstInstall = hil.indexOf("release_hil_install_once(", firstWatchdog);
  const rollbackTrigger = hil.indexOf("trigger_watchdog_cycle()", firstInstall);
  const secondWatchdog = hil.indexOf("with pending_image_power_watchdog(", firstWatchdog + 1);
  const secondInstall = hil.indexOf("release_hil_install_once(", secondWatchdog);
  const approval = hil.indexOf("approve_commit_candidate()", secondInstall);
  const health = hil.indexOf("wait_for_bench_health_window(", approval);
  const coldTrigger = hil.indexOf("release_hil_power_cycle(lab, power_token)", health);
  assert.ok(firstWatchdog >= 0 && firstInstall > firstWatchdog && rollbackTrigger > firstInstall);
  assert.ok(secondWatchdog > rollbackTrigger && secondInstall > secondWatchdog &&
    approval > secondInstall && health > approval && coldTrigger > health);
  const thirdWatchdog = hil.indexOf("with pending_image_power_watchdog(", secondWatchdog + 1);
  const writerInstall = hil.indexOf("candidate_writer_transfer = release_hil_install_once(", thirdWatchdog);
  const writerCallEnd = hil.indexOf("\n            )", writerInstall);
  const writerCall = hil.slice(writerInstall, writerCallEnd);
  assert.match(writerCall,
    /host=host,\s*mac=mac,\s*current_version=version,\s*current_elf=elf/);
  assert.match(writerCall, /version=lab\["bootstrap_version"\]/);
  assert.match(writerCall,
    /app_sha256=lab\["bootstrap_app_sha256"\],\s*elf=lab\["bootstrap_elf"\]/);
  assert.match(writerCall, /manifest_url=lab\["bootstrap_manifest_url"\]/);
  assert.match(writerCall, /firmware_base_url=lab\["bootstrap_firmware_base_url"\]/);
  assert.match(writerCall, /allow_downgrade=True/);
  const writerDowngrade = hil.indexOf("allow_downgrade=True", writerInstall);
  const writerTrigger = hil.indexOf("trigger_writer_watchdog_cycle()", writerDowngrade);
  const writerRollback = hil.indexOf("writer_rollback = wait_for_identity(", writerTrigger);
  const writerValid = hil.indexOf("writer_image_state = wait_for_ota_image_state(", writerRollback);
  assert.ok(thirdWatchdog > coldTrigger && writerInstall > thirdWatchdog &&
    writerCallEnd > writerInstall &&
    writerDowngrade > writerInstall && writerTrigger > writerDowngrade &&
    writerRollback > writerTrigger && writerValid > writerRollback);
  const watchdog = section(
    gate, "def pending_image_power_watchdog(", "\ndef wait_for_identity(",
  );
  assert.doesNotMatch(watchdog, /\/renew/);
  assert.match(watchdog, /\/release/);
  assert.match(hil, /wait_for_ota_image_state\(committed_endpoint, rollback_pending=False\)/);
  assert.match(hil, /wait_for_ota_image_state\(cold_endpoint, rollback_pending=False\)/);
  const install = section(gate, "def release_hil_install_once(", "\ndef run_release_hil(");
  assert.equal((install.match(/allow_downgrade=allow_downgrade/g) || []).length, 2);
  assert.match(install, /hil_manifest_url=manifest_url/);
  assert.match(install, /hil_firmware_base_url=firmware_base_url/);
  assert.match(install, /wait_for_ota_image_state\(endpoint, rollback_pending=True\)/);
  assert.match(install,
    /wait_for_ota_image_state\(endpoint, rollback_pending=True\)[\s\S]{0,180}?post_witness_status\s*=\s*request_status_deadline\(endpoint, timeout=HTTP_TIMEOUT_S\)/);
  assert.match(install,
    /validate_identity\([\s\S]{0,100}?post_witness_status[\s\S]{0,180}?require_release_hil_channel\(post_witness_status, channel\)/);
  assert.match(install, /return post_witness_status, transfer/);

  const production = gate.slice(gate.indexOf("if args.confirm_production != PRODUCTION_ROLE"));
  assert.match(production, /production_evidence\s*=\s*stress_board\([\s\S]{0,300}?require_x10a=True,[\s\S]{0,100}?require_weather=True,/);
};

const runCentral = () => spawnSync(process.execPath, [centralContract], {
  cwd: root,
  env: { ...process.env, PRODUCTION_OTA_CONTRACT_ROOT: tmp },
  encoding: "utf8",
});

const runContracts = () => {
  const central = runCentral();
  if (central.status !== 0) return central;
  try {
    supplementalContract();
    return { status: 0, stdout: central.stdout, stderr: central.stderr };
  } catch (error) {
    return { status: 1, stdout: central.stdout, stderr: `${central.stderr}${error.stack}\n` };
  }
};

try {
  restore();
  const baseline = runContracts();
  if (baseline.status !== 0) {
    process.stderr.write(baseline.stdout + baseline.stderr);
    throw new Error("production OTA contracts are already red on the unmodified tree");
  }

  const cases = [
    ["the bench role is redirected to production", () =>
      replaceOnce("scripts/production-ota-gate.py", 'BENCH_ROLE = "bench"', 'BENCH_ROLE = "production"')],
    ["the pressure window is shortened", () =>
      replaceOnce("scripts/production-ota-gate.py", "STRESS_SECONDS = 180", "STRESS_SECONDS = 60")],
    ["the manifest observer is shorter than firmware's bounded check", () =>
      replaceOnce("scripts/production-ota-gate.py", "OTA_CHECK_TIMEOUT_S = 120", "OTA_CHECK_TIMEOUT_S = 30")],
    ["the sole-write observer is shorter than firmware's install", () =>
      replaceOnce("scripts/production-ota-gate.py", "OTA_TIMEOUT_S = 480", "OTA_TIMEOUT_S = 180")],
    ["chunked framing accepts an unsupported transfer coding", () =>
      replaceOnce("scripts/production-ota-gate.py", 'transfer_encodings[0] != b"chunked"', "False")],
    ["chunk sizes are no longer strict hexadecimal", () =>
      replaceOnce("scripts/production-ota-gate.py", 're.fullmatch(rb"[0-9A-Fa-f]+", size_text)', "True")],
    ["chunk bodies can exceed their fixed bound", () =>
      replaceOnce("scripts/production-ota-gate.py", "chunk_size > max_body_bytes - len(body)", "False")],
    ["chunk trailers and trailing bytes are accepted", () =>
      replaceOnce("scripts/production-ota-gate.py", "chunked HTTP response has trailers or bytes after its terminator", "ignored trailing chunk bytes")],
    ["malformed HTTP 503 responses bypass full framing classification", () =>
      replaceOnce("scripts/production-ota-gate.py", "if status < 200 or status >= 300:", "if False:")],
    ["status pressure re-resolves the board hostname", () =>
      replaceNth("scripts/production-ota-gate.py", "request_status_deadline(status_endpoint, timeout=HTTP_TIMEOUT_S)", 'request_json(host, "/status")', 2)],
    ["full status stress reuses the compact OTA deadline", () =>
      replaceOnce(
        "scripts/production-ota-gate.py",
        /(def status_loop\(\)[\s\S]{0,360}?request_status_deadline\(\s*pinned_endpoint, timeout=)HTTP_TIMEOUT_S,/,
        "$1OTA_STATUS_REQUEST_TIMEOUT_S,",
      )],
    ["values pressure re-resolves the board hostname", () =>
      replaceOnce("scripts/production-ota-gate.py", "request_values_deadline(status_endpoint, timeout=HTTP_TIMEOUT_S)", 'request_json(host, "/values")')],
    ["offer polling ignores the exact application SHA", () =>
      replaceOnce("scripts/production-ota-gate.py", 'status.get("available_sha256") != expected_app_sha256', "False")],
    ["offer polling ignores the exact channel", () =>
      replaceOnce("scripts/production-ota-gate.py", 'status.get("available_channel") != expected_channel', "False")],
    ["offer polling ignores the accepted generation", () =>
      replaceOnce("scripts/production-ota-gate.py", "generation != expected_generation", "False")],
    ["the sole update write omits its exact SHA", () =>
      replaceOnce("scripts/production-ota-gate.py", '"sha256": expected_app_sha256', '"ignored": expected_app_sha256')],
    ["the update no longer requires the successor generation", () =>
      replaceOnce("scripts/production-ota-gate.py", "check_generation + 1", "check_generation")],
    ["the deterministic weather refresh no longer waits for idle", () =>
      replaceOnce("scripts/production-ota-gate.py", "weather did not become idle before its HIL refresh", "weather idle wait bypassed")],
    ["the deterministic weather refresh call is removed", () =>
      replaceNth("scripts/production-ota-gate.py", "request_weather_refresh(", "ignore_weather_refresh(", 2)],
    ["the weather refresh becomes persistent", () =>
      replaceOnce("scripts/production-ota-gate.py", '"refresh": True', '"refresh": False')],
    ["firmware Weather refresh ignores diagnostics consent", () =>
      replaceOnce("main/http_config.cpp", "if (!c.diagnostics_enabled)", "if (false)")],
    ["firmware Weather refresh acknowledges a missing task", () =>
      replaceOnce("main/http_config.cpp", "if (!weather_forecast_request_refresh(refresh_token))", "if (false)")],
    ["Weather HIL accepts a foreign success edge", () =>
      replaceOnce("scripts/production-ota-gate.py",
        'refresh_fields["refresh_completed_token"] == weather_refresh_token',
        'weather_candidate.get("successes", 0) > weather_successes_before')],
    ["Weather HIL success is not tied to the real update commit", () =>
      replaceOnce("main/weather_forecast.cpp", "refresh_attempt.finish(updated);",
        "refresh_attempt.finish(ok);")],
    ["Weather TLS completion is not stack-sampled", () =>
      replaceNth("main/weather_forecast.cpp", "stack_watch_sample(StackWatch::Weather);",
        "stack_watch_sample_bypassed(StackWatch::Weather);", 2)],
    ["Weather loses its dedicated stack-watch slot", () =>
      replaceOnce("main/stack_watch.hpp", "    Weather, //", "    Climate, //")],
    ["Weather stack evidence is omitted from always-on status", () =>
      replaceOnce("main/http_status.cpp", 'j += ",\\\"weather\\\":";', 'j += ",\\\"ignored_weather_stack\\\":";')],
    ["mandatory Weather stress no longer requires Weather stack evidence", () =>
      replaceOnce("scripts/production-ota-gate.py", 'required_tasks.add("weather")', 'required_tasks.add("poll")')],
    ["Weather refresh leaves a duplicate-cycle wake queued", () =>
      replaceOnce("main/weather_forecast.cpp",
        "if (refresh_attempt.token != 0) ulTaskNotifyTake(pdTRUE, 0);",
        "if (false) ulTaskNotifyTake(pdTRUE, 0);")],
    ["Weather refresh publishes its wake after releasing the token mutex", () =>
      replaceOnce("main/weather_forecast.cpp",
        "        xTaskNotifyGive(task);\n    }\n    return true;",
        "    }\n    xTaskNotifyGive(task);\n    return true;")],
    ["Weather source replacement leaves an old refresh token outstanding", () =>
      replaceOnce("main/weather_forecast.cpp",
        "        weather_refresh_cancel_outstanding(s_refresh_requested_token, s_refresh_completed_token);",
        "        // old refresh token left outstanding")],
    ["Weather source cancellation is overwritten by a late success finish", () =>
      replaceOnce("main/logic/weather_forecast.hpp", "completed_token == token", "false")],
    ["Weather refresh POST omits its causal token", () =>
      replaceOnce("main/http_config.cpp", "\\\"refresh_token\\\":%llu", "\\\"ignored_token\\\":%llu")],
    ["a saved Weather location acknowledges before synchronous invalidation", () =>
      replaceNth("main/http_config.cpp",
        "weather_change.commit();",
        "weather_change.commit_after_response();", 2)],
    ["pressure workers stop catching parser GateError", () =>
      replaceOnce("scripts/production-ota-gate.py", /(def probe\([\s\S]{0,1400}?)except BaseException as error:/, "$1except Exception as error:")],
    ["pressure workers discard unexpected parser failures", () =>
      replaceOnce("scripts/production-ota-gate.py", 'unexpected.append(f"{kind}: {error}")', "pass  # unexpected parser failure discarded")],
    ["pressure workers may outlive the gate", () =>
      replaceOnce("scripts/production-ota-gate.py", "if worker.is_alive():", "if False:")],
    ["the root release-HIL policy falls back to schema 2", () =>
      replaceOnce("scripts/production-ota-gate.py", "release-HIL root policy must be schema_version 3", "release-HIL root policy must be schema_version 2")],
    ["the release-HIL inventory falls back to schema 2", () =>
      replaceOnce("scripts/production-ota-gate.py", "release-HIL inventory must be a schema_version 3 object", "release-HIL inventory must be a schema_version 2 object")],
    ["the root policy no longer pins the bootstrap application SHA", () =>
      replaceOnce("scripts/production-ota-gate.py", '"bootstrap_app_sha256",', "")],
    ["the bootstrap version identity is dropped", () =>
      replaceOnce("scripts/production-ota-gate.py", 'old_version != lab["bootstrap_version"]', "False")],
    ["the bootstrap ELF identity is dropped", () =>
      replaceOnce("scripts/production-ota-gate.py", 'old_elf != lab["bootstrap_elf"]', "False")],
    ["the pinned bootstrap artifact is not verified before hardware mutation", () =>
      replaceOnce(
        "scripts/production-ota-gate.py",
        "bootstrap_artifact = verify_release_hil_bootstrap_artifact(lab)",
        "bootstrap_artifact = {}",
      )],
    ["the pinned bootstrap application SHA is not checked", () =>
      replaceOnce(
        "scripts/production-ota-gate.py",
        'hashlib.sha256(app).hexdigest() != lab["bootstrap_app_sha256"]', "False",
      )],
    ["canonical controller URLs accept percent encoding", () =>
      replaceOnce("scripts/production-ota-gate.py", '"%" in parsed.path', "False")],
    ["canonical controller URLs accept dot segments", () =>
      replaceOnce("scripts/production-ota-gate.py", 'any(segment in (".", "..") for segment in parsed.path.split("/"))', "False")],
    ["derived controller URLs may escape their authorized prefix", () =>
      replaceOnce("scripts/production-ota-gate.py", "not parsed.path.startswith(base.path)", "False")],
    ["the watchdog status GET is removed from the controller allowlist", () =>
      replaceOnce("scripts/production-ota-gate.py", '("GET", "POST", "DELETE")', '("POST", "DELETE")')],
    ["controller GET requests may carry an entity payload", () =>
      replaceOnce(
        "scripts/production-ota-gate.py", 'if method == "GET" and payload is not None:',
        "if False:",
      )],
    ["controller GET requests emit JSON entity headers", () =>
      replaceOnce("scripts/production-ota-gate.py", 'if method != "GET":', "if True:")],
    ["mutating controller requests may omit their object payload", () =>
      replaceOnce(
        "scripts/production-ota-gate.py",
        'if method != "GET" and not isinstance(payload, dict):', "if False:",
      )],
    ["the gate omits the HIL manifest request header", () =>
      replaceOnce("scripts/production-ota-gate.py", "HIL_MANIFEST_HEADER: manifest_url", '"X-Ignored-Manifest": manifest_url')],
    ["the gate omits the HIL firmware-base request header", () =>
      replaceOnce("scripts/production-ota-gate.py", "HIL_FIRMWARE_BASE_HEADER: firmware_base_url", '"X-Ignored-Firmware": firmware_base_url')],
    ["extra headers are no longer restricted to HIL OTA checks", () =>
      replaceOnce("scripts/production-ota-gate.py", "set(extra_headers) != HIL_FEED_HEADERS", "False")],
    ["the HIL header pair is not sent on the accepted check", () =>
      replaceNth("scripts/production-ota-gate.py", "extra_headers=hil_headers", "extra_headers=None", 2)],
    ["the HIL header pair is not sent during combined stress", () =>
      replaceNth("scripts/production-ota-gate.py", "extra_headers=hil_headers", "extra_headers=None", 1)],
    ["the accepted generation no longer binds effective HIL URLs", () =>
      replaceOnce("scripts/production-ota-gate.py", 'status.get("effective_manifest_url") != expected_manifest_url', "False")],
    ["the release-HIL install omits its transient manifest URL", () =>
      replaceOnce("scripts/production-ota-gate.py", "hil_manifest_url=manifest_url", "hil_manifest_url=None")],
    ["the feed-controller acknowledgement ignores the leased manifest URL", () =>
      replaceOnce("scripts/production-ota-gate.py", 'result.get("manifest_url") != manifest_url', "False")],
    ["the HIL manifest override header is removed", () =>
      replaceOnce("main/http_ota.cpp", "X-Daikin-HIL-Manifest-URL", "X-Ignored-HIL-Manifest-URL")],
    ["the HIL firmware-base override header is removed", () =>
      replaceOnce("main/http_ota.cpp", "X-Daikin-HIL-Firmware-Base-URL", "X-Ignored-HIL-Firmware-Base-URL")],
    ["partial HIL header pairs are accepted", () =>
      replaceOnce("main/http_ota.cpp", "feed_result == OtaHilFeedHeaderResult::PartialPair", "false")],
    ["the HIL override is not passed to the OTA check", () =>
      replaceOnce("main/http_ota.cpp", "ota_check_async(ms, override_feed)", "ota_check_async(ms, nullptr)")],
    ["effective manifest URL evidence is omitted", () =>
      replaceOnce("main/http_ota.cpp", 'j += ",\\"effective_manifest_url\\":"', 'j += ",\\"ignored_manifest_url\\":"')],
    ["effective firmware-base URL evidence is omitted", () =>
      replaceOnce("main/http_ota.cpp", 'j += ",\\"effective_firmware_base_url\\":"', 'j += ",\\"ignored_firmware_base_url\\":"')],
    ["pending-image status evidence is omitted", () =>
      replaceOnce("main/http_ota.cpp", 'j += ",\\"image_state\\":"', 'j += ",\\"ignored_image_state\\":"')],
    ["the offer lease ignores generation replacement", () =>
      replaceOnce("main/logic/ota_hil_feed.hpp", "binding.generation != generation", "false")],
    ["the offer lease ignores the exact channel", () =>
      replaceOnce("main/logic/ota_hil_feed.hpp", "bound_channel != channel", "false")],
    ["the offer lease ignores the exact version", () =>
      replaceOnce("main/logic/ota_hil_feed.hpp", "bound_version != version", "false")],
    ["the offer lease ignores the exact application SHA", () =>
      replaceOnce("main/logic/ota_hil_feed.hpp", "std::memcmp(binding.app_sha256.data(), app_sha256, binding.app_sha256.size()) != 0", "false")],
    ["the offer lease drops its effective feed", () =>
      replaceOnce("main/logic/ota_hil_feed.hpp", "out = binding.feed;", "ota_feed_urls_clear(out);")],
    ["the first pending-image watchdog is bypassed", () =>
      replaceNth("scripts/production-ota-gate.py", "with pending_image_power_watchdog(", "with bypassed_pending_image_watchdog(", 1)],
    ["the committed candidate's pending-image watchdog is bypassed", () =>
      replaceNth("scripts/production-ota-gate.py", "with pending_image_power_watchdog(", "with bypassed_pending_image_watchdog(", 2)],
    ["the candidate-writer rollback watchdog is bypassed", () =>
      replaceNth("scripts/production-ota-gate.py", "with pending_image_power_watchdog(", "with bypassed_pending_image_watchdog(", 3)],
    ["the rollback watchdog is not triggered after the first install", () =>
      replaceOnce("scripts/production-ota-gate.py", "trigger_watchdog_cycle()", "rollback_cycle_bypassed()")],
    ["the committed candidate is not explicitly approved before autonomous commit", () =>
      replaceOnce("scripts/production-ota-gate.py", "approve_commit_candidate()", "candidate_approval_bypassed()")],
    ["the committed candidate is not cold-cycled after health", () =>
      replaceOnce("scripts/production-ota-gate.py", "release_hil_power_cycle(lab, power_token)", "cold_cycle_bypassed()")],
    ["the hard watchdog deadline extends beyond firmware commit", () =>
      replaceOnce("scripts/production-ota-gate.py", "PENDING_IMAGE_WATCHDOG_TTL_S = 80", "PENDING_IMAGE_WATCHDOG_TTL_S = 100")],
    ["the first candidate is not proved rollback-pending", () =>
      replaceOnce("scripts/production-ota-gate.py", "wait_for_ota_image_state(endpoint, rollback_pending=True)", "{}")],
    ["the rollback boundary reuses the pre-witness candidate status", () =>
      replaceOnce(
        "scripts/production-ota-gate.py",
        "post_witness_status = request_status_deadline(endpoint, timeout=HTTP_TIMEOUT_S)",
        "post_witness_status = status",
      )],
    ["the release-HIL install returns the pre-witness candidate status", () =>
      replaceOnce(
        "scripts/production-ota-gate.py", "return post_witness_status, transfer",
        "return status, transfer",
      )],
    ["the committed candidate is not proved valid before cold cycle", () =>
      replaceOnce("scripts/production-ota-gate.py", "wait_for_ota_image_state(committed_endpoint, rollback_pending=False)", "committed_image_state_bypassed()")],
    ["the candidate writer is not allowed to select the older pinned bootstrap", () =>
      replaceNth("scripts/production-ota-gate.py", "allow_downgrade=True", "allow_downgrade=False", 3)],
    ["the candidate-writer source identity is not the committed candidate", () =>
      replaceOnce(
        "scripts/production-ota-gate.py",
        "current_version=version, current_elf=elf",
        'current_version=lab["bootstrap_version"], current_elf=elf',
      )],
    ["the candidate writer targets the wrong bootstrap version", () =>
      replaceOnce(
        "scripts/production-ota-gate.py", 'version=lab["bootstrap_version"]',
        "version=version",
      )],
    ["the candidate writer targets the wrong bootstrap application", () =>
      replaceOnce(
        "scripts/production-ota-gate.py", 'app_sha256=lab["bootstrap_app_sha256"]',
        "app_sha256=app_sha256",
      )],
    ["the candidate writer checks the candidate manifest instead of the bootstrap manifest", () =>
      replaceOnce(
        "scripts/production-ota-gate.py", 'manifest_url=lab["bootstrap_manifest_url"]',
        'manifest_url=lab["manifest_url"]',
      )],
    ["the candidate writer downloads from the candidate base instead of the bootstrap base", () =>
      replaceOnce(
        "scripts/production-ota-gate.py",
        'firmware_base_url=lab["bootstrap_firmware_base_url"]',
        'firmware_base_url=lab["firmware_base_url"]',
      )],
    ["the candidate-writer rollback does not prove the candidate is valid", () =>
      replaceOnce(
        "scripts/production-ota-gate.py",
        "writer_image_state = wait_for_ota_image_state(",
        "writer_image_state = writer_image_state_bypassed(",
      )],
    ["the OTA task stack sample is dropped before reboot", () =>
      replaceOnce("scripts/production-ota-gate.py", '("ota_stack_min_free_bytes", "ota_stack_min_free_bytes"),', '("ignored_ota_stack", "ignored_ota_stack"),')],
    ["the OTA task stack floor is bypassed", () =>
      replaceOnce("scripts/production-ota-gate.py", "ota_stack < 1024", "ota_stack < 0")],
    ["controller requests lose their whole-operation deadline", () =>
      replaceNth("scripts/production-ota-gate.py", "deadline = time.monotonic() + HTTP_TIMEOUT_S", "deadline = float('inf')", 2)],
    ["controller DNS no longer consumes the whole-operation deadline", () =>
      replaceOnce("scripts/production-ota-gate.py", "resolution_done.wait(remaining())", "resolution_done.wait(HTTP_TIMEOUT_S)")],
    ["controller connect no longer consumes the remaining deadline", () =>
      replaceOnce("scripts/production-ota-gate.py", "candidate.settimeout(remaining())", "candidate.settimeout(HTTP_TIMEOUT_S)")],
    ["controller TLS handshake is no longer explicitly deadline-bound", () =>
      replaceOnce("scripts/production-ota-gate.py", "do_handshake_on_connect=False", "do_handshake_on_connect=True")],
    ["post-cycle identity falls back to an unbounded status reader", () =>
      replaceOnce(
        "scripts/production-ota-gate.py",
        "status = request_status_deadline(\n                    endpoint, timeout=min(remaining, HTTP_TIMEOUT_S),\n                )",
        'status = request_json(host, "/status")',
      )],
    ["the release-HIL health dwell falls back to an unbounded status reader", () =>
      replaceOnce(
        "scripts/production-ota-gate.py",
        "status = request_status_deadline(\n            endpoint, timeout=min(remaining, HTTP_TIMEOUT_S),\n        )",
        'status = request_json(host, "/status")',
      )],
    ["the release-HIL bootstrap snapshot uses an unbounded status reader", () =>
      replaceOnce(
        "scripts/production-ota-gate.py",
        "before = request_status_deadline(initial_endpoint, timeout=HTTP_TIMEOUT_S)",
        'before = request_json(host, "/status")',
      )],
    ["the release-HIL final snapshot uses an unbounded status reader", () =>
      replaceOnce(
        "scripts/production-ota-gate.py",
        "final = request_status_deadline(final_endpoint, timeout=HTTP_TIMEOUT_S)",
        'final = request_json(host, "/status")',
      )],
    ["the signature verifier is bypassed", () =>
      replaceOnce("scripts/production-ota-gate.py", 'ROOT / "scripts/require-signed.sh"', 'ROOT / "scripts/signature-check-bypassed.sh"')],
    ["the legacy bench restore manifest ceiling is weakened", () =>
      replaceOnce("scripts/production-ota-gate.py",
        "LEGACY_BENCH_RESTORE_MANIFEST_MAX_BYTES = 1024",
        "LEGACY_BENCH_RESTORE_MANIFEST_MAX_BYTES = 2048")],
    ["the official dev manifest fetch is no longer host-memory bounded", () =>
      replaceOnce("scripts/production-ota-gate.py",
        "manifest_bytes = request_limited_bytes(",
        "manifest_bytes = request_bytes(")],
    ["the first official dev snapshot rebind is bypassed", () =>
      replaceNth("scripts/production-ota-gate.py",
        "require_official_dev_manifest_snapshot(\n        target_manifest_sha256, target_source_sha, target_version, target_sha256,\n    )",
        "official_dev_manifest_snapshot_bypassed(\n        target_manifest_sha256, target_source_sha, target_version, target_sha256,\n    )", 1)],
    ["the final official dev snapshot rebind is bypassed", () =>
      replaceNth("scripts/production-ota-gate.py",
        "require_official_dev_manifest_snapshot(\n            target_manifest_sha256, target_source_sha, target_version, target_sha256,\n        )",
        "official_dev_manifest_snapshot_bypassed(\n            target_manifest_sha256, target_source_sha, target_version, target_sha256,\n        )", 1)],
    ["the ordinary release leg drops its transient manifest binding", () =>
      replaceOnce("scripts/production-ota-gate.py",
        "hil_manifest_url=OFFICIAL_RELEASE_MANIFEST_URL,",
        "hil_manifest_url=None,")],
    ["the ordinary release write expects a persisted release channel", () =>
      replaceOnce("scripts/production-ota-gate.py",
        "expected_channel=\"dev\", allow_downgrade=True,\n        )\n        release_status = wait_for_new_firmware(",
        "expected_channel=\"release\", allow_downgrade=True,\n        )\n        release_status = wait_for_new_firmware(")],
    ["the official release manifest fetch is no longer host-memory bounded", () =>
      replaceOnce("scripts/production-ota-gate.py",
        "release_manifest_bytes = request_limited_bytes(",
        "release_manifest_bytes = request_bytes(")],
    ["the bounded remote reader grows to the entire response", () =>
      replaceOnce("scripts/production-ota-gate.py",
        "payload = response.read(max_bytes + 1)",
        "payload = response.read()")],
    ["the bounded remote reader loses its whole-operation deadline", () =>
      replaceOnce("scripts/production-ota-gate.py",
        "if not completed.wait(timeout):",
        "if False and not completed.wait(timeout):")],
    ["the legacy restore preflight is bypassed before bench access", () =>
      replaceNth("scripts/production-ota-gate.py",
        "require_legacy_bench_restore_manifest(manifest_bytes, manifest)",
        "legacy_bench_restore_preflight_bypassed(manifest_bytes, manifest)", 2)],
    ["the legacy restore preflight accepts escaped identities", () =>
      replaceOnce("scripts/production-ota-gate.py",
        'if b"\\\\" in manifest_bytes:',
        'if False and b"\\\\" in manifest_bytes:')],
    ["future releases are no longer bound to their version tag", () =>
      replaceOnce("scripts/production-ota-gate.py",
        "if source_sha == tagged_source:",
        "if True:")],
    ["the historical restore release app identity is ignored", () =>
      replaceOnce("scripts/production-ota-gate.py",
        "if (version, source_sha, app_sha256) == (",
        "if (version, source_sha, LEGACY_RELEASE_APP_SHA256) == (")],
    ["the official release source binding is bypassed before bench access", () =>
      replaceOnce("scripts/production-ota-gate.py",
        "verify_release_source_binding(release_version, release_source_sha, release_sha256)",
        "release_source_binding_bypassed(release_version, release_source_sha, release_sha256)")],
    ["the official release feed is replaced", () =>
      replaceOnce("scripts/production-ota-gate.py", 'OFFICIAL_RELEASE_MANIFEST_URL = "https://0bu.github.io/daikin-altherma-esp32/manifest.json"', 'OFFICIAL_RELEASE_MANIFEST_URL = "https://example.invalid/manifest.json"')],
    ["the production canary disables X10A", () =>
      replaceOnce("scripts/production-ota-gate.py", /(production_evidence = stress_board\([\s\S]{0,220}?)require_x10a=True,/, "$1require_x10a=False,")],
    ["the production canary disables weather TLS", () =>
      replaceOnce("scripts/production-ota-gate.py", /(production_evidence = stress_board\([\s\S]{0,220}?)require_weather=True,/, "$1require_weather=False,")],
    ["raw OTA writes are no longer routed through the gate", () =>
      replaceOnce("tools/agent-hooks/agent_hook.py", "direct OTA writes are forbidden; run scripts/production-ota-gate.py", "direct OTA writes are allowed")],
    ["a failed health cap no longer forces rollback", () =>
      replaceOnce("main/ota_update.cpp", /(HealthVerdict::GiveUp[\s\S]{0,700}?)esp_restart\(\);/, "$1ota_rollback_restart_bypassed();")],
  ];

  let caught = 0;
  for (const [name, mutate] of cases) {
    restore();
    mutate();
    const result = runContracts();
    if (result.status === 0) throw new Error(`production OTA contracts missed mutation: ${name}`);
    caught++;
    console.log(`production OTA selftest: detected — ${name}`);
  }
  console.log(`production OTA selftest: all ${caught} seeded regressions caught`);
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
