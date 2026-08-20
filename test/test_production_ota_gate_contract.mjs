// Source-boundary contract for the bench -> production OTA promotion gate. Hardware cannot run
// in CI, but CI can keep every fail-closed boundary reachable: exact board/artifact identity,
// signed dev-only provenance, bounded live pressure, a single un-retried production POST, retained
// X10A proof, and firmware rollback refusing a merely-online but heap-broken image.
import assert from "node:assert/strict";
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
const mqtt = read("main/mqtt_ha.cpp");

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
assert.doesNotMatch(gate, /add_argument\([^\n]*stress|skip[-_]local|skip[-_]test|no[-_]stress/i,
  "the production command must expose no short-duration or skipped-test bypass");
assert.match(gate,
  /OFFICIAL_MANIFEST_URL\s*=\s*"https:\/\/0bu\.github\.io\/daikin-altherma-esp32\/dev\/manifest\.json"/,
  "only the official dev feed may enter production promotion");
assert.match(gate, /manifest_url\s*!=\s*OFFICIAL_MANIFEST_URL/,
  "foreign and release manifests must fail before download");
assert.match(gate, /provenance\.get\("source_sha"\)\s*!=\s*expected_source_sha/,
  "the published source SHA must match the explicit promotion target");
assert.match(gate, /hashlib\.sha256\(binary\)\.hexdigest\(\)/,
  "the downloaded image must be matched byte-for-byte to manifest provenance");
assert.match(gate, /scripts\/require-signed\.sh/,
  "the downloaded application must pass the Secure Boot v2 signature gate");
assert.match(gate, /git",\s*"rev-parse",\s*"HEAD"/,
  "local host contracts must run on the manifest's exact main source");
assert.match(gate, /git",\s*"status",\s*"--porcelain"/,
  "dirty local code must not stand in for the published source");
assert.match(gate, /scripts\/run-mock-tests\.sh/,
  "catalog-wide pure X10A replay must run before hardware promotion");
assert.match(gate, /scripts\/run-contract-tests\.sh/,
  "all X10A, OTA, production-promotion and public-readiness contracts must run before hardware promotion");

const testStress = gate.indexOf("test_evidence = stress_board(");
const productionConfirmation = gate.indexOf("if args.confirm_production != PRODUCTION_ROLE");
const offer = gate.indexOf('wait_for_ota_offer(production["host"], args.expected_version)');
const post = gate.indexOf('    post_update_once(production["host"])', productionConfirmation);
const returned = gate.indexOf('wait_for_new_firmware(production["host"], args.expected_version, elf)');
const productionStress = gate.indexOf("production_evidence = stress_board(");
const retained = gate.indexOf("retained = verify_retained_x10a(final_status)");
assert.ok(testStress >= 0 && productionConfirmation > testStress && offer > productionConfirmation &&
          post > offer && returned > post && productionStress > returned && retained > productionStress,
  "bench stress, explicit production confirmation, one update, reboot proof, canary stress and retained X10A must stay ordered");
assert.match(gate,
  /test_evidence = stress_board\([\s\S]{0,200}?require_x10a=False, require_weather=False/,
  "the bench must not require intentionally absent X10A or optional weather consent");
assert.match(gate,
  /production_evidence = stress_board\([\s\S]{0,200}?require_x10a=True, require_weather=True/,
  "the production canary must keep live X10A, timeout-delta and weather-TLS enforcement enabled");
assert.equal(occurrences(gate, 'method="POST"'), 1,
  "the entire promotion implementation may contain exactly one production POST");
assert.match(gate, /Deliberately one un-retried write/,
  "the sole production write must remain explicitly non-retrying");
assert.match(gate, /OTA_OFFER_SETTLE_SECONDS\s*=\s*1\.0/,
  "the exact OTA offer must settle past the retiring check task before the sole update POST");
assert.match(gate, /OTA_OFFER_POLL_SECONDS\s*=\s*0\.1/,
  "the gate must poll quickly enough to observe the fresh check generation fail-closed");
assert.match(gate,
  /status\.get\("state"\)\s*==\s*"checking":[\s\S]{0,80}?return\s+False,\s*True,\s*None[\s\S]{0,100}?if not seen_checking:[\s\S]{0,80}?return\s+False,\s*False,\s*None/,
  "a fresh checking transition must be observed before any idle offer can arm");
assert.match(gate,
  /first_seen_at\s+is\s+None[\s\S]{0,120}?return\s+False,\s*True,\s*now[\s\S]{0,180}?now\s*-\s*first_seen_at\s*>=\s*OTA_OFFER_SETTLE_SECONDS/,
  "the first idle offer sample must arm, not pass, the production write boundary");
assert.match(gate,
  /status\.get\("available"\)\s*!=\s*expected_version\s+or\s+not\s+status\.get\("update_available"\):[\s\S]{0,400}?return\s+False,\s*True,\s*None\s+if first_seen_at is None/,
  "a stale result from the previous asynchronous check must wait, never authorize or reject the write");
assert.match(gate,
  /wait_for_ota_offer[\s\S]{0,900}?seen_checking\s*=\s*False[\s\S]{0,300}?ota_offer_settled\([\s\S]{0,200}?if ready:[\s\S]{0,80}?return status/,
  "production offer polling must use the stable two-sample hand-off decision");
assert.match(gate, /did not settle on the exact gated dev version within 30 seconds/,
  "a stale or wrong offer must remain bounded and fail closed at the polling deadline");
assert.match(gate, /for key in \("heap_restarts", "mqtt_skipped", "poll_skipped", "crc_err"\)/,
  "heap/OOM/X10A failure counters must remain stable through each pressure window");
assert.match(gate,
  /return require_x10a and final\["timeout_err"\] - baseline\["timeout_err"\] > MAX_X10A_TIMEOUT_DELTA/,
  "an X10A-less bench must not fail on expected bus timeouts while production remains bounded");
assert.match(gate, /worker\.start\(\)[\s\S]{0,500}?\/ota\/check\?ms=/,
  "real OTA manifest TLS must overlap the concurrent HTTP pressure workers");
assert.match(gate, /ota_check\.get\("state"\)\s*!=\s*"idle"[\s\S]{0,100}?ota_check\.get\("available"\)\s*!=\s*version/,
  "the overlapping OTA TLS request must finish against the exact promoted dev artifact");
assert.match(gate,
  /if require_weather:[\s\S]{0,500}?weather\.get\("successes", 0\)[\s\S]{0,160}?weather\.get\("fetched_at"\)/,
  "the production role must carry successful real weather TLS evidence from its fresh boot");
assert.match(gate, /MIN_FINAL_LARGEST_BLOCK\s*=\s*16\s*\*\s*1024/,
  "hardware acceptance must recover a 16 KiB contiguous block");
assert.match(gate, /release_created": False/,
  "the production OTA gate must state and preserve its no-release boundary");

assert.match(hook, /direct OTA writes are forbidden; run scripts\/production-ota-gate\.py/,
  "agent shell writes must be routed through the canonical production gate");
assert.match(hook, /canonical_production_ota_command/,
  "only the canonical direct gate command may bypass the raw OTA-write guard");

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

console.log("production OTA gate: signed bench staging, one-shot production canary and rollback service proof pinned");
