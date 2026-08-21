#!/usr/bin/env node
// Prove the production OTA source contract still detects removal of its load-bearing boundaries.
// Every mutation runs in an isolated throwaway tree; hardware is never contacted.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const contract = path.join(root, "test/test_production_ota_gate_contract.mjs");
const files = [
  "scripts/production-ota-gate.py",
  "tools/agent-hooks/agent_hook.py",
  "main/logic/health_gate.hpp",
  "main/ota_update.cpp",
  "main/http_ota.cpp",
  "main/mqtt_ha.cpp",
  "main/logic/ota_quiesce.hpp",
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
const run = () => spawnSync(process.execPath, [contract], {
  cwd: root,
  env: { ...process.env, PRODUCTION_OTA_CONTRACT_ROOT: tmp },
  encoding: "utf8",
});

try {
  restore();
  const baseline = run();
  if (baseline.status !== 0) {
    process.stderr.write(baseline.stdout + baseline.stderr);
    throw new Error("production OTA contract is already red on the unmodified tree");
  }

  const cases = [
    ["the test-board role is redirected to production", () =>
      replaceOnce("scripts/production-ota-gate.py", 'BENCH_ROLE = "bench"',
        'BENCH_ROLE = "production"')],
    ["the pressure window is shortened", () =>
      replaceOnce("scripts/production-ota-gate.py", "STRESS_SECONDS = 180", "STRESS_SECONDS = 60")],
    ["the manifest observer is shorter than firmware's bounded check path", () =>
      replaceOnce("scripts/production-ota-gate.py", "OTA_CHECK_TIMEOUT_S = 120",
        "OTA_CHECK_TIMEOUT_S = 30")],
    ["the sole-write observer is shorter than firmware's bounded install path", () =>
      replaceOnce("scripts/production-ota-gate.py", "OTA_TIMEOUT_S = 480", "OTA_TIMEOUT_S = 180")],
    ["publisher quiescence no longer outlives the authoritative observer", () =>
      replaceOnce("main/logic/ota_quiesce.hpp", "OTA_QUIESCE_MAX_CYCLES = 600",
        "OTA_QUIESCE_MAX_CYCLES = 480")],
    ["the official bench release feed is replaced", () =>
      replaceOnce("scripts/production-ota-gate.py",
        'OFFICIAL_RELEASE_MANIFEST_URL = "https://0bu.github.io/daikin-altherma-esp32/manifest.json"',
        'OFFICIAL_RELEASE_MANIFEST_URL = "https://example.test/manifest.json"')],
    ["the full bench binary exercise is bypassed", () =>
      replaceOnce("scripts/production-ota-gate.py",
        "full_download_evidence = exercise_bench_full_download(",
        "full_download_evidence = bench_manifest_only_bypass(")],
    ["the freshly installed target skips its health window", () =>
      replaceOnce("scripts/production-ota-gate.py",
        "target_health_window = wait_for_bench_health_window(",
        "target_health_window = bypass_target_health_window(")],
    ["the target is denied its explicit bench downgrade", () =>
      replaceOnce("scripts/production-ota-gate.py",
        'expected_channel="release", allow_downgrade=True',
        'expected_channel="release", allow_downgrade=False')],
    ["the bench is not restored to the dev channel", () =>
      replaceOnce("scripts/production-ota-gate.py",
        'set_update_channel(host, "dev")',
        'set_update_channel(host, "release")')],
    ["the release health-window wait is bypassed", () =>
      replaceOnce("scripts/production-ota-gate.py",
        "release_health_window = wait_for_bench_health_window(",
        "release_health_window = bypass_release_health_window(")],
    ["a gate-only change no longer republishes an exact-source artifact", () =>
      replaceOnce(".github/workflows/build.yml", "|production-ota-gate", "")],
    ["full-transfer status busy refusal is no longer required", () =>
      replaceOnce("scripts/production-ota-gate.py",
        'for key in ("status_busy_503", "values_busy_503", "diag_ok", "ota_status_ok"):',
        'for key in ("values_busy_503", "diag_ok", "ota_status_ok"):')],
    ["full-transfer heap telemetry is no longer required", () =>
      replaceOnce("scripts/production-ota-gate.py",
        'fail(f"{host} target OTA did not expose sampled operation-local heap minima")',
        'pass  # heap telemetry bypassed')],
    ["offer polling ignores a replaced operation generation", () =>
      replaceOnce("scripts/production-ota-gate.py", "generation != expected_generation",
        "False")],
    ["offer polling ignores the authoritative busy claim", () =>
      replaceOnce("scripts/production-ota-gate.py", 'if status.get("busy") is True:',
        "if False:")],
    ["offer polling ignores the checked application SHA", () =>
      replaceOnce("scripts/production-ota-gate.py",
        'status.get("available_sha256") != expected_app_sha256',
        "False")],
    ["the sole update POST omits the checked application SHA", () =>
      replaceOnce("scripts/production-ota-gate.py", '"sha256": expected_app_sha256',
        '"ignored": expected_app_sha256')],
    ["the update may skip over an intervening accepted operation", () =>
      replaceOnce("scripts/production-ota-gate.py",
        "expected_generation = 1 if check_generation == 0xFFFFFFFF else check_generation + 1",
        "expected_generation = check_generation")],
    ["legacy firmware is silently allowed into the one-write path", () =>
      replaceOnce("scripts/production-ota-gate.py", "no update POST was sent",
        "legacy update may continue")],
    ["a rejected firmware operation is reported as HTTP success", () =>
      replaceOnce("main/http_ota.cpp", 'httpd_resp_set_status(req, "503 Service Unavailable");',
        'httpd_resp_set_status(req, "200 OK");')],
    ["the signature verifier is bypassed", () =>
      replaceOnce("scripts/production-ota-gate.py", 'ROOT / "scripts/require-signed.sh"',
        'ROOT / "scripts/signature-check-bypassed.sh"')],
    ["the complete source-contract runner is skipped", () =>
      replaceOnce("scripts/production-ota-gate.py", 'ROOT / "scripts/run-contract-tests.sh"',
        'ROOT / "scripts/run-contract-smoke.sh"')],
    ["real OTA TLS is removed from the pressure window", () =>
      replaceOnce("scripts/production-ota-gate.py", 'f"/ota/check?ms={int(time.time() * 1000)}"',
        '"/ota/status"')],
    ["the reboot waiter polls full status while OTA still owns TLS", () =>
      replaceOnce("scripts/production-ota-gate.py",
        'if ota.get("state") not in ("checking", "updating", "done"):',
        'if True:')],
    ["the target verifier completion is no longer observed", () =>
      replaceOnce("scripts/production-ota-gate.py",
        'if target_transfer.get("saw_done") is not True:',
        'if False:')],
    ["the final contiguous-block floor is reduced", () =>
      replaceOnce("scripts/production-ota-gate.py", "MIN_FINAL_LARGEST_BLOCK = 16 * 1024",
        "MIN_FINAL_LARGEST_BLOCK = 8 * 1024")],
    ["an unwired bench is subjected to the production X10A timeout limit", () =>
      replaceOnce("scripts/production-ota-gate.py", "return require_x10a and final[\"timeout_err\"]",
        "return True and final[\"timeout_err\"]")],
    ["the production canary disables its X10A requirement", () =>
      replaceOnce("scripts/production-ota-gate.py",
        /(production_evidence = stress_board\([\s\S]{0,200}?)require_x10a=True,/,
        "$1require_x10a=False,")],
    ["the production canary disables its weather TLS requirement", () =>
      replaceOnce("scripts/production-ota-gate.py",
        /(production_evidence = stress_board\([\s\S]{0,200}?)require_weather=True,/,
        "$1require_weather=False,")],
    ["the no-release result is falsified", () =>
      replaceOnce("scripts/production-ota-gate.py", '"release_created": False',
        '"release_created": True')],
    ["raw OTA writes are no longer routed through the gate", () =>
      replaceOnce("tools/agent-hooks/agent_hook.py", "direct OTA writes are forbidden; run scripts/production-ota-gate.py",
        "direct OTA writes are allowed")],
    ["a merely connected image can bypass allocation failure evidence", () =>
      replaceOnce("main/logic/health_gate.hpp", "!service.allocation_failures && x10a_ready",
        "x10a_ready")],
    ["an accepted X10A publish no longer raises proof", () =>
      replaceOnce("main/mqtt_ha.cpp", "s_x10a_publish_proven.store(true, std::memory_order_release)",
        "s_x10a_publish_proven.store(false, std::memory_order_release)")],
    ["a failed health cap no longer forces rollback", () =>
      replaceOnce("main/ota_update.cpp",
        /(HealthVerdict::GiveUp[\s\S]{0,500}?)esp_restart\(\);/,
        "$1ota_rollback_restart_bypassed();")],
  ];

  let caught = 0;
  for (const [name, mutate] of cases) {
    restore();
    mutate();
    const result = run();
    if (result.status === 0) throw new Error(`production OTA contract missed mutation: ${name}`);
    caught++;
    console.log(`production OTA selftest: detected — ${name}`);
  }
  console.log(`production OTA selftest: all ${caught} seeded regressions caught`);
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
