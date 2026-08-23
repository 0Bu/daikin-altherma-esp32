// Source-boundary contract for role-pinned bench OTA delivery and bench -> production promotion.
// Hardware cannot run in CI, but CI can keep every fail-closed boundary reachable: exact
// board/artifact identity, signed dev-only provenance, bounded live pressure, single un-retried
// writes, retained production X10A proof, and rollback refusing a merely-online heap-broken image.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const defaultRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const root = path.resolve(process.env.PRODUCTION_OTA_CONTRACT_ROOT || defaultRoot);
const read = rel => fs.readFileSync(path.join(root, rel), "utf8");
const occurrences = (text, token) => text.split(token).length - 1;

const gate = read("scripts/production-ota-gate.py");
const hook = read("tools/agent-hooks/agent_hook.py");
const health = read("main/logic/health_gate.hpp");
const ota = read("main/ota_update.cpp");
const httpOta = read("main/http_ota.cpp");
const mqtt = read("main/mqtt_ha.cpp");
const quiesce = read("main/logic/ota_quiesce.hpp");
const workflow = read(".github/workflows/build.yml");

const abbreviatedOption = spawnSync("python3", [
  path.join(root, "scripts/production-ota-gate.py"),
  "--manifest", "https://0bu.github.io/daikin-altherma-esp32/dev/manifest.json",
], { encoding: "utf8" });
assert.equal(abbreviatedOption.status, 2,
  "an abbreviated gate option must be rejected before any preflight or device contact");
assert.match(abbreviatedOption.stderr, /unrecognized arguments: --manifest/,
  "argparse must reject abbreviations instead of silently mapping them onto canonical options");

assert.match(gate, /BENCH_ROLE\s*=\s*"bench"[\s\S]{0,100}?PRODUCTION_ROLE\s*=\s*"production"/,
  "the bench stage must remain distinct and ordered before production");
assert.match(gate, /production-ota\.json/,
  "private board host/MAC identity must come from the local untracked inventory");
assert.match(gate, /bench and production inventory identities must be distinct/,
  "the two roles must not resolve to the same host or MAC");
assert.doesNotMatch(gate, /192\.168\.|(?:[0-9A-F]{2}:){5}[0-9A-F]{2}/,
  "the public gate must not publish a private address or real board identifier");
assert.match(gate, /STRESS_SECONDS\s*=\s*180/,
  "both hardware stages need the fixed three-minute pressure window");
const otaCheckTimeout = Number(gate.match(/OTA_CHECK_TIMEOUT_S\s*=\s*(\d+)/)?.[1]);
const otaTimeout = Number(gate.match(/OTA_TIMEOUT_S\s*=\s*(\d+)/)?.[1]);
const quiesceCycles = Number(quiesce.match(/OTA_QUIESCE_MAX_CYCLES\s*=\s*(\d+)/)?.[1]);
assert.ok(otaCheckTimeout >= 120,
  "host check observer must include two setup attempts, headroom waits, and manifest body deadline");
assert.ok(otaTimeout >= 480,
  "the sole-write observer must outlive re-manifest, five-minute firmware deadline, verification and reboot");
assert.ok(quiesceCycles > otaTimeout,
  "publisher/poller quiescence must strictly outlive the authoritative host observer");
assert.equal(occurrences(gate, "time.monotonic() + OTA_CHECK_TIMEOUT_S"), 4,
  "stress, production offer, legacy offer and bench return must share the safe check timeout");
assert.match(ota, /kManifestDeadline\s*=\s*pdMS_TO_TICKS\(30000\)/,
  "the host check timeout relation must remain tied to the firmware manifest deadline");
assert.match(ota, /kFirmwareDeadline\s*=\s*pdMS_TO_TICKS\(5 \* 60 \* 1000\)/,
  "the host update timeout relation must remain tied to the firmware transfer deadline");
assert.doesNotMatch(gate, /add_argument\([^\n]*stress|skip[-_]local|skip[-_]test|no[-_]stress/i,
  "the production command must expose no short-duration or skipped-test bypass");
assert.match(gate,
  /OFFICIAL_MANIFEST_URL\s*=\s*"https:\/\/0bu\.github\.io\/daikin-altherma-esp32\/dev\/manifest\.json"/,
  "only the official dev feed may enter production promotion");
assert.match(gate,
  /OFFICIAL_RELEASE_MANIFEST_URL\s*=\s*"https:\/\/0bu\.github\.io\/daikin-altherma-esp32\/manifest\.json"/,
  "the bench rollback exercise must use only the official stable feed");
assert.match(gate, /manifest_url\s*!=\s*OFFICIAL_MANIFEST_URL/,
  "foreign and release manifests must fail before download");
assert.match(gate, /provenance\.get\("source_sha"\)\s*!=\s*expected_source_sha/,
  "the published source SHA must match the explicit promotion target");
assert.match(gate, /hashlib\.sha256\(binary\)\.hexdigest\(\)/,
  "the downloaded image must be matched byte-for-byte to manifest provenance");
assert.match(gate, /scripts\/require-signed\.sh/,
  "the downloaded application must pass the Secure Boot v2 signature gate");
const rangeHelperStart = gate.indexOf("def verify_http_range_support(");
const rangeHelperEnd = gate.indexOf("\ndef cache_busted(", rangeHelperStart);
assert.ok(rangeHelperStart >= 0 && rangeHelperEnd > rangeHelperStart,
  "the read-only official-artifact Range preflight must remain identifiable");
const rangeHelper = gate.slice(rangeHelperStart, rangeHelperEnd);
assert.match(rangeHelper, /"Range": "bytes=0-0"/,
  "the host preflight must request the same byte-range mechanism used by firmware resume");
assert.match(rangeHelper,
  /response\.status\s*!=\s*206[\s\S]{0,220}?content_range\s*!=\s*\[f"bytes 0-0\/\{len\(binary\)\}"\][\s\S]{0,160}?content_length\s*!=\s*"1"/,
  "the official host must prove exact 206 Content-Range and Content-Length semantics");
assert.match(rangeHelper, /body\s*!=\s*binary\[:1\]/,
  "the ranged byte must match the already signature- and SHA-bound artifact");
assert.equal(occurrences(gate, "verify_http_range_support("), 3,
  "the helper definition plus dev and release artifact checks must remain present");
const appRange = gate.indexOf("verify_http_range_support(app_url, binary)");
const releaseRange = gate.indexOf("verify_http_range_support(release_url, release_binary)");
const inventoryLoad = gate.indexOf("inventory = load_inventory()", appRange);
const productionBenchContact = gate.indexOf('test_before = request_json(bench["host"], "/status")', releaseRange);
assert.ok(appRange >= 0 && inventoryLoad > appRange && releaseRange > inventoryLoad &&
          productionBenchContact > releaseRange,
  "dev Range must precede inventory use, and production staging must prove release Range before board contact");
assert.match(gate, /git",\s*"rev-parse",\s*"HEAD"/,
  "local host contracts must run on the manifest's exact main source");
assert.match(gate, /git",\s*"status",\s*"--porcelain"/,
  "dirty local code must not stand in for the published source");
const buildRelevant = workflow.match(/relevant='([^']+)'/)?.[1];
assert.ok(buildRelevant && new RegExp(buildRelevant).test("scripts/production-ota-gate.py"),
  "a gate-only source change must publish a new artifact with the same exact source identity");
assert.match(gate, /scripts\/run-mock-tests\.sh/,
  "catalog-wide pure X10A replay must run before hardware promotion");
assert.match(gate, /scripts\/run-contract-tests\.sh/,
  "all X10A, OTA, production-promotion and public-readiness contracts must run before hardware promotion");

const targetHealthWindow = gate.indexOf("target_health_window = wait_for_bench_health_window(");
const fullDownload = gate.indexOf("full_download_evidence = exercise_bench_full_download(");
const testStress = gate.indexOf("test_evidence = stress_board(", fullDownload);
const productionConfirmation = gate.indexOf("if args.confirm_production != PRODUCTION_ROLE");
const offer = gate.indexOf("check_generation = wait_for_ota_offer(", productionConfirmation);
const post = gate.indexOf("    post_update_once(", offer);
const returned = gate.indexOf('wait_for_new_firmware(production["host"], args.expected_version, elf)');
const productionStress = gate.indexOf("production_evidence = stress_board(");
const retained = gate.indexOf("retained = verify_retained_x10a(final_status)");
assert.ok(targetHealthWindow >= 0 && fullDownload > targetHealthWindow && testStress > fullDownload &&
          productionConfirmation > testStress &&
          offer > productionConfirmation &&
          post > offer && returned > post && productionStress > returned && retained > productionStress,
  "full bench binary OTA, bench stress, production confirmation, one production update, reboot proof, canary stress and retained X10A must stay ordered");
const fullHelperStart = gate.indexOf("def exercise_bench_full_download(");
const fullHelperEnd = gate.indexOf("\ndef require_ota_transfer_evidence(", fullHelperStart);
assert.ok(fullHelperStart >= 0 && fullHelperEnd > fullHelperStart,
  "the full bench download helper must remain identifiable");
const fullHelper = gate.slice(fullHelperStart, fullHelperEnd);
const releaseOffer = fullHelper.indexOf('expected_channel="release", allow_downgrade=True');
const releasePost = fullHelper.indexOf("post_update_once(", releaseOffer);
const releaseBoot = fullHelper.indexOf("release_status = wait_for_new_firmware(", releasePost);
const releaseHealthWindow = fullHelper.indexOf("release_health_window = wait_for_bench_health_window(", releaseBoot);
const devChannel = fullHelper.indexOf('set_update_channel(host, "dev")', releaseHealthWindow);
const targetBoot = fullHelper.indexOf("target_status = wait_for_new_firmware(", devChannel);
assert.ok(releaseOffer >= 0 && releasePost > releaseOffer && releaseBoot > releasePost &&
  releaseHealthWindow > releaseBoot && devChannel > releaseHealthWindow && targetBoot > devChannel,
  "the target must perform a complete release download, survive rollback probation, and return to the exact dev artifact before staging passes");
assert.match(fullHelper,
  /try:[\s\S]{0,500}?post_update_once\([\s\S]{0,500}?wait_for_new_firmware\([\s\S]{0,300}?finally:[\s\S]{0,160}?stop\.set\(\)[\s\S]{0,180}?worker\.join/,
  "bench pressure workers must always stop and join when the target OTA fails closed");
assert.match(gate, /BENCH_HEALTH_WINDOW_S\s*=\s*105/,
  "each newly installed bench image must survive beyond its 90-second health window");
const healthWindowStart = gate.indexOf("def wait_for_bench_health_window(");
const healthWindowEnd = gate.indexOf("\ndef wait_for_legacy_offer(", healthWindowStart);
const healthWindowHelper = gate.slice(healthWindowStart, healthWindowEnd);
assert.ok(healthWindowStart >= 0 && healthWindowEnd > healthWindowStart,
  "the shared target/release health-window helper must remain identifiable");
assert.match(healthWindowHelper,
  /uptime_s[\s\S]{0,900}?heap_restarts[\s\S]{0,300}?mqtt_skipped[\s\S]{0,300}?poll_skipped[\s\S]{0,900}?MIN_FINAL_FREE_HEAP[\s\S]{0,300}?MIN_FINAL_LARGEST_BLOCK/,
  "both health-window phases must require sufficient uptime, no allocation failures and safe heap");
assert.match(gate,
  /target_health_window = wait_for_bench_health_window\([\s\S]{0,180}?phase="target"/,
  "the target must survive a healthy dwell before the release exercise");
assert.match(fullHelper,
  /release_health_window = wait_for_bench_health_window\([\s\S]{0,180}?phase="release"/,
  "the rollback-exercise release must survive the commit window before dev restore");
assert.match(gate,
  /for key in \("status_busy_503", "values_busy_503", "diag_ok", "ota_status_ok"\)[\s\S]{0,300}?target OTA did not expose sampled operation-local heap minima/,
  "the full binary exercise must prove fast snapshot refusal, live compact surfaces and OTA-local heap telemetry");
assert.match(gate,
  /test_evidence = stress_board\([\s\S]{0,200}?require_x10a=False, require_weather=False/,
  "the bench must not require intentionally absent X10A or optional weather consent");
assert.match(gate,
  /production_evidence = stress_board\([\s\S]{0,200}?require_x10a=True, require_weather=True/,
  "the production canary must keep live X10A, timeout-delta and weather-TLS enforcement enabled");
assert.equal(occurrences(gate, 'method="POST"'), 3,
  "the only POST call sites are channel selection, exact-artifact update and legacy bench restore");
const productionExecution = gate.slice(productionConfirmation);
assert.equal(occurrences(productionExecution, "post_update_once("), 1,
  "the production execution block must invoke exactly one update write");
assert.doesNotMatch(productionExecution, /set_update_channel|legacy bench|\/ota\/update.*method="POST"/,
  "bench channel/legacy writes must never be reachable from the production execution block");
assert.match(gate, /Deliberately one un-retried exact-artifact write per invocation/,
  "every exact-artifact update invocation must remain explicitly non-retrying");
assert.match(gate, /OTA_OFFER_POLL_SECONDS\s*=\s*0\.1/,
  "the gate must observe the accepted operation without a long blind polling gap");
assert.match(gate, /OTA_STATUS_POLL_SECONDS\s*=\s*0\.1/,
  "the gate must sample the short completed OTA state before reboot");
assert.match(gate, /LEGACY_OFFER_STABLE_SECONDS\s*=\s*3\.0/,
  "the bench-only legacy return must outwait stale idle status from the accepted check");
const legacyOfferWait = gate.slice(gate.indexOf("def wait_for_legacy_offer("),
  gate.indexOf("\ndef exercise_bench_full_download(", gate.indexOf("def wait_for_legacy_offer(")));
assert.match(legacyOfferWait,
  /stable_since:\s*float\s*\|\s*None\s*=\s*None[\s\S]{0,500}?now\s*-\s*stable_since\s*>=\s*LEGACY_OFFER_STABLE_SECONDS[\s\S]{0,160}?stable_since\s*=\s*None/,
  "the legacy offer must remain continuously exact and idle before the one bench restore write");
const newFirmwareWait = gate.slice(gate.indexOf("def wait_for_new_firmware("),
  gate.indexOf("\ndef set_update_channel(", gate.indexOf("def wait_for_new_firmware(")));
assert.match(newFirmwareWait,
  /ota\.get\("state"\)\s+not\s+in\s+\("checking",\s*"updating",\s*"done"\)[\s\S]{0,160}?request_json\(host,\s*"\/status"\)/,
  "the reboot waiter must not poll allocation-rich /status while OTA owns TLS");
assert.match(newFirmwareWait,
  /except HTTPError as error:[\s\S]{0,100}?error\.code\s*!=\s*503/,
  "an expected busy-503 must not abort reboot observation");
assert.match(gate,
  /target_transfer\.get\("saw_done"\)\s+is\s+not\s+True[\s\S]{0,100}?never exposed its completed validation state/,
  "bench acceptance must observe the target verifier's completed state, not just recovered heap");
assert.match(gate,
  /generation\s*=\s*status\.get\("generation"\)[\s\S]{0,180}?generation\s*!=\s*expected_generation[\s\S]{0,120}?operation generation changed/,
  "offer status must stay bound to the synchronously accepted check generation");
assert.match(gate,
  /status\.get\("busy"\)\s+is\s+True:[\s\S]{0,80}?return False[\s\S]{0,140}?status\.get\("busy"\)\s+is\s+not\s+False[\s\S]{0,140}?required OTA busy handshake/,
  "the exact generation must explicitly release its busy claim before the production write");
assert.match(gate,
  /accepted\s*=\s*request_json\(host, f"\/ota\/check[\s\S]{0,240}?generation\s*=\s*accepted\.get\("generation"\)[\s\S]{0,260}?generation handshake/,
  "the manifest check must synchronously return the generation that status polling follows");
assert.match(gate,
  /lacks or refused the OTA generation handshake[\s\S]{0,160}?signed NVS-preserving USB bootstrap[\s\S]{0,100}?no update POST was sent/,
  "legacy firmware must fail before the write with an explicit physical-bootstrap boundary");
assert.match(gate,
  /post_update_once[\s\S]{0,900}?fields\s*=\s*\{[\s\S]{0,300}?"after": check_generation[\s\S]{0,300}?"channel": expected_channel[\s\S]{0,300}?"version": expected_version[\s\S]{0,300}?"sha256": expected_app_sha256[\s\S]{0,500}?request_json\(host, f"\/ota\/update\?\{query\}"[\s\S]{0,600}?generation\s*!=\s*expected_generation/,
  "each exact update POST must bind the checked generation, channel and artifact, then require its immediate successor");
assert.match(gate,
  /expected_generation\s*=\s*1 if check_generation == 0xFFFFFFFF else check_generation \+ 1/,
  "the accepted update must be the immediate wrap-safe successor of the checked operation");
assert.match(gate,
  /status\.get\("available"\)\s*!=\s*expected_version[\s\S]{0,160}?available_sha256[\s\S]{0,160}?expected_app_sha256[\s\S]{0,160}?available_channel[\s\S]{0,160}?expected_channel/,
  "the completed check status must match version, application SHA and channel before the write");
assert.match(gate, /did not settle on the exact gated artifact within \{OTA_CHECK_TIMEOUT_S\} seconds/,
  "a stale or wrong offer must remain bounded and fail closed at the polling deadline");
assert.equal(occurrences(httpOta, '503 Service Unavailable'), 2,
  "both busy check and busy update requests must return a non-success HTTP status");
const checkAccepted = httpOta.indexOf('ota_check_async(ms)');
const updateAccepted = httpOta.indexOf('ota_update_async(static_cast<uint32_t>(after_value)');
const firstGenerationResponse = httpOta.indexOf('{\\"ok\\":true,\\"generation\\":%lu}', checkAccepted);
const secondGenerationResponse = httpOta.indexOf('{\\"ok\\":true,\\"generation\\":%lu}', updateAccepted);
assert.ok(checkAccepted >= 0 && firstGenerationResponse > checkAccepted &&
          updateAccepted > firstGenerationResponse && secondGenerationResponse > updateAccepted,
  "accepted check and update requests must each return their authoritative generation");
assert.match(httpOta,
  /j\s*\+=\s*",\\"busy\\":"[\s\S]{0,100}?s\.busy[\s\S]{0,100}?j\s*\+=\s*",\\"generation\\":"[\s\S]{0,100}?number\(s\.generation\)/,
  "OTA status must expose busy and generation from the same mutex-protected snapshot");
assert.match(httpOta, /available_sha256[\s\S]{0,180}?available_channel/,
  "OTA status must expose the exact checked artifact identity consumed by host and UI");
assert.match(gate, /for key in \("heap_restarts", "mqtt_skipped", "poll_skipped", "crc_err"\)/,
  "heap/OOM/X10A failure counters must remain stable through each pressure window");
assert.match(gate,
  /return require_x10a and final\["timeout_err"\] - baseline\["timeout_err"\] > MAX_X10A_TIMEOUT_DELTA/,
  "an X10A-less bench must not fail on expected bus timeouts while production remains bounded");
assert.match(gate, /worker\.start\(\)[\s\S]{0,500}?\/ota\/check\?ms=/,
  "real OTA manifest TLS must overlap the concurrent HTTP pressure workers");
assert.match(gate, /MQTT_RECOVERY_TIMEOUT_S\s*=\s*15/,
  "the intentional OTA transport pause must have a bounded MQTT recovery window");
assert.match(gate,
  /started\s*=\s*request_json\(host, "\/status"\)[\s\S]{0,220}?started\.get\("mqtt", \{\}\)\.get\("connected"\)[\s\S]{0,100}?MQTT must be connected before the pressure window/,
  "an existing MQTT outage must fail before the intentional OTA pause is armed");
const manifestSet = gate.indexOf("manifest_active.set()", gate.indexOf("def stress_board("));
const mqttRecoverySet = gate.indexOf("mqtt_recovery_expected.set()", manifestSet);
const manifestClear = gate.indexOf("manifest_active.clear()", mqttRecoverySet);
const mqttRecoveryPoll = gate.indexOf('mqtt_recovery_status = request_json(host, "/status", timeout=1)', manifestClear);
assert.ok(manifestSet >= 0 && mqttRecoverySet > manifestSet && manifestClear > mqttRecoverySet &&
          mqttRecoveryPoll > manifestClear,
  "the pressure gate must distinguish the intentional TLS pause and observe MQTT recovery afterward");
const statusLoopStart = gate.indexOf("def status_loop() -> None:");
const otaExpectedStart = gate.indexOf(
  "ota_expected_before = mqtt_recovery_expected.is_set()", statusLoopStart);
const statusRequestStart = gate.indexOf(
  'status = request_json(host, "/status")', statusLoopStart);
const recoveryObserveStart = gate.indexOf(
  "disconnected += mqtt_recovery.observe(", otaExpectedStart);
const stickyOtaLease = gate.indexOf(
  "ota_expected=ota_expected_before or mqtt_recovery_expected.is_set()", recoveryObserveStart);
assert.ok(statusLoopStart >= 0 && otaExpectedStart > statusLoopStart &&
          statusRequestStart > otaExpectedStart && recoveryObserveStart > statusRequestStart &&
          stickyOtaLease > recoveryObserveStart,
  "only a request-local expected OTA pause may suppress MQTT disconnect samples; later outages must still fail");
assert.match(gate,
  /weather_evidence = weather_fetching or weather_successes > self\.weather_successes_seen[\s\S]{0,700}?self\.weather_expected = True[\s\S]{0,120}?self\.weather_deadline = now \+ MQTT_RECOVERY_TIMEOUT_S/,
  "the deliberate weather-TLS transport pause must arm a bounded MQTT recovery allowance");
assert.match(gate,
  /self\.weather_successes_seen = max\(self\.weather_successes_seen, weather_successes\)/,
  "the completed weather fetch must cover the status-update to asynchronous MQTT-resume gap");
const weatherEvidenceStart = gate.indexOf("if weather_evidence:");
const weatherEvidenceEnd = gate.indexOf(
  "self.weather_successes_seen = max", weatherEvidenceStart);
const weatherEvidenceBranch = gate.slice(weatherEvidenceStart, weatherEvidenceEnd);
assert.ok(weatherEvidenceStart >= 0 && weatherEvidenceEnd > weatherEvidenceStart,
  "the weather-evidence tracker branch must remain identifiable");
const pendingExpiryStart = gate.indexOf(
  "if self.pending_disconnects and now > self.pending_deadline:");
assert.ok(pendingExpiryStart >= 0 && pendingExpiryStart < weatherEvidenceStart,
  "an expired unexplained disconnect must fail before later weather evidence can clear it");
assert.match(weatherEvidenceBranch,
  /self\.pending_disconnects = 0/,
  "a mixed pre-weather snapshot must remain pending until later weather evidence or its deadline");
const mqttConnectedStart = gate.indexOf("if mqtt_connected:");
const mqttConnectedEnd = gate.indexOf("elif not ota_expected:", mqttConnectedStart);
const mqttConnectedBranch = gate.slice(mqttConnectedStart, mqttConnectedEnd);
assert.ok(mqttConnectedStart >= 0 && mqttConnectedEnd > mqttConnectedStart,
  "the connected and disconnected MQTT tracker branches must remain identifiable");
assert.match(mqttConnectedBranch,
  /if not weather_evidence or weather_was_expected or pending_was_observed:[\s\S]{0,120}?self\.weather_expected = False/,
  "a reconnect without weather evidence must not silently discard a pending disconnect");
assert.match(gate,
  /elif not ota_expected:[\s\S]{0,160}?if self\.weather_expected:[\s\S]{0,120}?now > self\.weather_deadline[\s\S]{0,500}?now > self\.pending_deadline/,
  "weather recovery must close on reconnect and expire instead of hiding later broker outages");
assert.match(gate,
  /def finish\(self\) -> int:[\s\S]{0,160}?failures = self\.pending_disconnects/,
  "the tracker must return an unexplained deferred disconnect at finish");
assert.match(gate,
  /disconnected \+= mqtt_recovery\.finish\(\)/,
  "an unexplained deferred disconnect must fail when the pressure window ends");
assert.match(gate,
  /mqtt_recovery_deadline\s*=\s*time\.monotonic\(\) \+ MQTT_RECOVERY_TIMEOUT_S[\s\S]{0,700}?validate_identity\(mqtt_recovery_status[\s\S]{0,220}?mqtt_recovery_status\.get\("mqtt", \{\}\)\.get\("connected"\)[\s\S]{0,100}?mqtt_recovery_expected\.clear\(\)/,
  "MQTT recovery must come from a new identity-checked status request started after TLS released");
assert.match(gate,
  /finished\.get\("mqtt", \{\}\)\.get\("connected"\)[\s\S]{0,100}?MQTT was not connected after the pressure window/,
  "final hardware acceptance must still require a connected MQTT session");
assert.match(gate,
  /busy_503\["status"\][\s\S]{0,600}?busy_503\["values"\][\s\S]{0,2200}?did not prove fast status\/values refusal/,
  "the manifest pressure stage must accept only the intentional OTA busy-503 window and require observing both snapshot refusals");
assert.match(gate, /ota_check\.get\("state"\)\s*!=\s*"idle"[\s\S]{0,100}?ota_check\.get\("available"\)\s*!=\s*version/,
  "the overlapping OTA TLS request must finish against the exact promoted dev artifact");
assert.match(gate,
  /if require_weather:[\s\S]{0,500}?weather\.get\("successes", 0\)[\s\S]{0,160}?weather\.get\("fetched_at"\)/,
  "the production role must carry successful real weather TLS evidence from its fresh boot");
assert.match(gate, /MIN_FINAL_LARGEST_BLOCK\s*=\s*16\s*\*\s*1024/,
  "hardware acceptance must recover a 16 KiB contiguous block");
assert.equal(occurrences(gate, '"release_created": False'), 2,
  "both bench delivery and production promotion must state and preserve the no-release boundary");

const benchHelperStart = gate.indexOf("def install_bench_target(");
const benchHelperEnd = gate.indexOf("\ndef self_test(", benchHelperStart);
assert.ok(benchHelperStart >= 0 && benchHelperEnd > benchHelperStart,
  "the ordinary bench-install helper must remain independently identifiable");
const benchHelper = gate.slice(benchHelperStart, benchHelperEnd);
const benchIdentity = benchHelper.indexOf("validate_identity(");
const benchOffer = benchHelper.indexOf("check_generation = wait_for_ota_offer(");
const benchPost = benchHelper.indexOf("update_generation = post_update_once(", benchOffer);
const benchReturn = benchHelper.indexOf("returned = wait_for_new_firmware(", benchPost);
const benchTransfer = benchHelper.indexOf("require_ota_transfer_evidence(", benchReturn);
const benchHealth = benchHelper.indexOf("health_window = wait_for_bench_health_window(", benchTransfer);
const benchStress = benchHelper.indexOf("stress = stress_board(", benchHealth);
assert.ok(benchIdentity >= 0 && benchOffer > benchIdentity && benchPost > benchOffer &&
          benchReturn > benchPost && benchTransfer > benchReturn && benchHealth > benchTransfer &&
          benchStress > benchHealth,
  "bench install must bind identity, lease one offer/write, observe verification, pass probation and then stress");
assert.equal(occurrences(benchHelper, "post_update_once("), 1,
  "ordinary bench delivery must invoke exactly one un-retried update write");
assert.match(benchHelper,
  /current_version == target_version[\s\S]{0,450}?ota[\s\S]{0,120}?channel[\s\S]{0,100}?!= "dev"[\s\S]{0,250}?MQTT must be connected/,
  "bench delivery must reject redundant versions, non-dev channels and missing MQTT before its write");
assert.match(benchHelper,
  /heap_restarts[\s\S]{0,180}?mqtt_skipped[\s\S]{0,180}?poll_skipped[\s\S]{0,500}?MIN_FINAL_FREE_HEAP[\s\S]{0,180}?MIN_FINAL_LARGEST_BLOCK/,
  "bench delivery must refuse existing allocation failures or unsafe pre-update heap");
assert.match(benchHelper,
  /reset_reason"\) != "sw"[\s\S]{0,500}?require_x10a=False, require_weather=False/,
  "bench acceptance must prove the OTA reboot and keep absent plant/weather sources optional");
assert.doesNotMatch(benchHelper,
  /PRODUCTION_ROLE|production\[|OFFICIAL_RELEASE_MANIFEST_URL|set_update_channel|wait_for_legacy_offer|allow_downgrade/,
  "the ordinary bench helper must not contain a production, release, channel-write or legacy path");

const benchAction = gate.indexOf("if args.install_bench or args.confirm_bench is not None:");
const benchInstall = gate.indexOf("bench_evidence = install_bench_target(", benchAction);
const benchActionReturn = gate.indexOf("        return 0", benchInstall);
const releaseManifestLoad = gate.indexOf("release_manifest = json.loads", benchActionReturn);
const productionTarget = gate.indexOf("production = inventory[PRODUCTION_ROLE]", releaseManifestLoad);
assert.ok(benchAction >= 0 && benchInstall > benchAction && benchActionReturn > benchInstall &&
          releaseManifestLoad > benchActionReturn && productionTarget > releaseManifestLoad,
  "bench action must return before release validation or production target construction");
assert.match(gate,
  /add_argument\("--install-bench", action="store_true"\)[\s\S]{0,1800}?args\.install_bench[\s\S]{0,240}?args\.execute[\s\S]{0,240}?args\.confirm_bench != BENCH_ROLE[\s\S]{0,240}?args\.confirm_production is not None/,
  "bench action must be explicit and mutually exclusive with production execution");
assert.match(gate, /ArgumentParser\(description=__doc__, allow_abbrev=False\)/,
  "the runtime parser must reject every abbreviation that the canonical hook grammar rejects");

assert.match(hook, /direct OTA writes are forbidden; run scripts\/production-ota-gate\.py/,
  "agent shell writes must be routed through the canonical role-pinned gate");
assert.match(hook, /canonical_production_ota_command/,
  "only the canonical direct gate command may bypass the raw OTA-write guard");
assert.match(hook, /"--install-bench"[\s\S]{0,220}?"--confirm-bench"\]\s*=\s*"bench"/,
  "the shell hook must admit only the explicit literal bench action and role");
assert.match(hook, /Path\(os\.path\.abspath\(executable\)\) != canonical/,
  "a foreign symlink alias must not impersonate the canonical gate path");
assert.match(hook,
  /def direct_ota_update_write[\s\S]{0,5200}?executable == "curl"[\s\S]{0,3200}?executable in \{"http", "xh"\}[\s\S]{0,2200}?executable == "wget"/,
  "raw OTA write detection must cover ordinary curl, HTTPie/xh and wget shapes");
assert.match(hook,
  /argument\.startswith\(\("--data", "--form", "--json=", "--upload-file="\)\)/,
  "all curl data/form long options, including equals forms, must imply an OTA write");
assert.match(hook,
  /for client_index, token in enumerate\(tokens\)/,
  "launcher-wrapped network clients must be inspected at every token position");
assert.ok(hook.includes('dynamic_client_arguments = any(re.search(r"[$`]", argument) for argument in raw_arguments)'),
  "dynamic shell arguments must remain visible to every OTA client classifier");
assert.match(hook,
  /executable == "curl"[\s\S]{0,3600}?dynamic_client_arguments and not forces_get/,
  "dynamic curl method/body arguments must fail unless GET or HEAD is literal");
assert.match(hook,
  /def curl_short_option_effects[\s\S]{0,900}?option == ":"[\s\S]{0,300}?option == "X"[\s\S]{0,300}?option in \{"d", "F", "T"\}/,
  "clustered curl next/X/data/form/upload short options must be decoded");
assert.ok(hook.includes("method, cluster_get, cluster_body, cluster_next, cluster_ambiguous = curl_short_option_effects("),
  "curl short-option effects must feed the write classifier");
assert.match(hook, /if cluster_next:\s*return True/,
  "curl's short -: transfer boundary must fail closed like --next");
assert.match(hook,
  /if "--next" in arguments:\s*return True/,
  "curl multi-transfer commands aimed at the OTA route must fail closed per transfer group");
assert.match(hook,
  /executable in \{"http", "xh"\}[\s\S]{0,900}?dynamic_client_arguments and explicit_methods not in \(\{"get"\}, \{"head"\}\)/,
  "dynamic HTTPie/xh method/body arguments must fail unless GET or HEAD is literal");
assert.match(hook,
  /executable == "wget"[\s\S]{0,900}?dynamic_client_arguments and not literal_safe_method/,
  "dynamic wget method/body arguments must fail unless GET or HEAD is literal");
assert.match(hook,
  /def wget_argument_may_write[\s\S]{0,900}?\("config", "execute", "post-file", "post-data"\)[\s\S]{0,300}?"method"\.startswith\(name\)[\s\S]{0,400}?aABDiIloOPQRtTUwX[\s\S]{0,200}?option == "e"/,
  "GNU Wget write controls must cover clustered short options and unique long abbreviations");
assert.match(hook,
  /def shell_sets_wgetrc[\s\S]{0,500}?\^wgetrc=/,
  "quote-normalized tokens must expose explicit Wget startup configuration");
assert.match(hook,
  /executable == "wget"[\s\S]{0,500}?shell_sets_wgetrc\(decoded, raw_tokens\)[\s\S]{0,200}?wget_argument_may_write\(argument\) for argument in raw_arguments/,
  "explicit Wget startup configuration and parsed write controls must fail closed");
assert.match(hook,
  /forces_get[\s\S]{0,1800}?not forces_get and/,
  "explicit curl GET shapes must not be mislabeled as OTA writes merely for carrying query data");
assert.match(hook,
  /forces_get\s*=\s*explicit_method in \{"get", "head"\} or \([\s\S]{0,160}?not explicit_method and \([\s\S]{0,120}?has_get_flag or any\(argument in \{"-g", "--get"\}/,
  "curl -G must prove GET only when no explicit method can override it");
assert.match(hook,
  /effective_method\s*=\s*""[\s\S]{0,500}?effective_method = arguments\[index \+ 1\][\s\S]{0,300}?literal_safe_method = effective_method in \{"get", "head"\}/,
  "only wget's final effective method may prove a literal GET or HEAD");
assert.match(hook,
  /executable in \{"http", "xh"\}[\s\S]{0,1200}?"post"[\s\S]{0,900}?":=" in argument[\s\S]{0,300}?"=" in argument and "==" not in argument/,
  "HTTPie/xh must detect a method after options and implicit body-field POSTs");
assert.match(hook,
  /"-methodpost"[\s\S]{0,240}?"request\(" in compact and \("data=" in compact or "json=" in compact\)/,
  "PowerShell and inferred interpreter body writes must remain visible to the raw classifier");
assert.match(hook,
  /"urlopen\(" in compact and "data=" in compact[\s\S]{0,140}?\(\?:request\|urlopen\)\\\(\[\^,\]\+,\[\^\)\]\+/,
  "urllib keyword and positional bodies must remain write-shaped");
assert.match(hook,
  /def possible_ota_update_route[\s\S]{0,1400}?expand_static_braces\(token\)[\s\S]{0,500}?fnmatch\.fnmatchcase\("ota", route\)[\s\S]{0,100}?fnmatch\.fnmatchcase\("update", action\)/,
  "shell variables and URL globs must remain in the raw-write classifier");
assert.match(hook,
  /https\?:\/\/\[\^'\\";&\|\]\*\[\$`\]\[\\s\\S\]\{0,160\}\/update/,
  "a dynamic URL segment immediately upstream of /update must fail closed");
assert.match(hook,
  /def shell_client_receives_stdin[\s\S]{0,800}?previous_control[\s\S]{0,500}?re\.fullmatch\(r"<\{1,3\}"/,
  "HTTPie/xh raw bodies and stdin must imply a write when no safe method is proven");
assert.match(hook,
  /shell_client_receives_stdin\(decoded, executable\)[\s\S]{0,600}?argument == "--raw"/,
  "the quote-aware stdin result and explicit raw-body flags must feed HTTPie write classification");
assert.match(hook,
  /raw_tokens\s*=\s*shell_syntax_tokens\(decoded\)[\s\S]{0,400}?\{"nc", "ncat", "netcat", "openssl", "socat", "telnet"\}[\s\S]{0,180}?\/dev\/\(\?:tcp\|udp\)\/[\s\S]{0,120}?if has_raw_network_client:\s*return True/,
  "every raw network client naming the OTA route must fail closed before method interpretation");
assert.match(hook,
  /def shell_argument_may_be_post[\s\S]{0,700}?expand_static_braces\(argument\.lower\(\)\)[\s\S]{0,500}?--method=post/,
  "brace- and glob-expanded client method arguments must remain write-shaped");
assert.doesNotMatch(hook,
  /def read_only_gate_inspection[\s\S]{0,1600}?executable == "git"/,
  "Git helpers, pagers, aliases and external diffs must not enter the inspection exception");
assert.match(hook,
  /def aliases_canonical_ota_gate[\s\S]{0,900}?shell_syntax_tokens\(command\)[\s\S]{0,900}?nested_tokens[\s\S]{0,900}?os\.path\.samefile\(lexical, canonical\)[\s\S]{0,100}?filecmp\.cmp\(lexical, canonical, shallow=False\)/,
  "renamed symlink, hardlink and exact-copy aliases must not execute the canonical OTA gate");
assert.match(hook,
  /token in \{"-S", "--split-string"\}[\s\S]{0,500}?token\.startswith\("-S"\)[\s\S]{0,300}?token\.startswith\("--split-string="\)/,
  "separate, attached and equals-form env split strings must be recursively classified");
assert.match(hook,
  /token in \{"-S", "--split-string"\}[\s\S]{0,160}?results\.extend\(shell_token_sets\(resolved_segment\[index \+ 1\], depth \+ 1\)\)/,
  "separate env split-string payloads must actually recurse");
assert.match(hook,
  /token\.startswith\("-S"\)[\s\S]{0,180}?shell_token_sets\(token\[2:\], depth \+ 1\)[\s\S]{0,220}?shell_token_sets\(token\.split\("=", 1\)\[1\], depth \+ 1\)/,
  "attached env split-string payloads must actually recurse");
assert.match(hook,
  /token_may_name_command\(token, "production-ota-gate\.py"\)/,
  "shell globs that resolve to the canonical gate must fail before execution");
assert.match(hook,
  /"production-ota-" in compact and "gate\.py" in compact[\s\S]{0,500}?"--manifest-url"[\s\S]{0,240}?"--expected-app-sha256"/,
  "dynamic gate executables carrying the canonical artifact option set must fail closed");
assert.match(hook,
  /re\.search\(r"\[\$`\]", token\) is not None and "\/scripts\/" in f"\/\{token\}"/,
  "embedded/default dynamic construction under scripts must fail closed");
assert.match(hook,
  /nested_tokens\.extend\(shell_token_sets\(nested\)\)/,
  "Git helper and pager strings must be recursively searched for renamed aliases");
assert.match(hook,
  /aliases_canonical_ota_gate\(payload, command\) and not read_only_inspection[\s\S]{0,120}?names_gate and not read_only_inspection/,
  "wrappers naming the gate must fail unless they are an explicit read-only source inspection");

assert.match(health, /OTA_HEALTH_MIN_FREE_BYTES\s*=\s*24u\s*\*\s*1024u/,
  "rollback commit needs the measured total internal-heap floor");
assert.match(health, /OTA_HEALTH_MIN_LARGEST_BLOCK_BYTES\s*=\s*16u\s*\*\s*1024u/,
  "rollback commit needs the production contiguous-block floor");
assert.match(health,
  /normal_service\s*=\s*service\.link\s*!=\s*NetLink::None\s*&&\s*service\.heap_ready\s*&&[\s\S]{0,100}!service\.allocation_failures\s*&&\s*x10a_ready/,
  "link alone must never commit an OTA image without heap, zero-skip and X10A proof");
assert.match(mqtt, /s_x10a_publish_proven\.store\(true,\s*std::memory_order_release\)/,
  "one accepted X10A state publish must raise the rollback proof");
assert.match(ota, /hp_link_connected\(\)\s*&&\s*mqtt_x10a_publish_required\(\)/,
  "broker-free installations must not be made un-updatable by an impossible publish proof");
assert.match(ota,
  /HealthVerdict::GiveUp[\s\S]{0,500}?PENDING_VERIFY[\s\S]{0,300}?esp_restart\(\);/,
  "a failed hard-cap proof must reboot while rollback remains armed");

assert.doesNotMatch(gate, /48\s*\*\s*60\s*\*\s*60|48[- ]?hour|48[- ]?stunden/i,
  "an arbitrary 48-hour soak must not replace targeted staging and canary evidence");

console.log("OTA gate: signed bench delivery, production promotion and rollback service proof pinned");
