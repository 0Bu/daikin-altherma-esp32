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
  "main/mqtt_ha.cpp",
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
    ["the production write races the retiring OTA check task", () =>
      replaceOnce("scripts/production-ota-gate.py", "OTA_OFFER_SETTLE_SECONDS = 1.0",
        "OTA_OFFER_SETTLE_SECONDS = 0.0")],
    ["a stale offer from the previous check aborts the fresh check", () =>
      replaceOnce("scripts/production-ota-gate.py",
        '        return False, None\n    if first_seen_at is None:',
        '        fail("production board did not offer the exact gated dev version")\n' +
        '    if first_seen_at is None:')],
    ["the signature verifier is bypassed", () =>
      replaceOnce("scripts/production-ota-gate.py", 'ROOT / "scripts/require-signed.sh"',
        'ROOT / "scripts/signature-check-bypassed.sh"')],
    ["the complete source-contract runner is skipped", () =>
      replaceOnce("scripts/production-ota-gate.py", 'ROOT / "scripts/run-contract-tests.sh"',
        'ROOT / "scripts/run-contract-smoke.sh"')],
    ["real OTA TLS is removed from the pressure window", () =>
      replaceOnce("scripts/production-ota-gate.py", 'f"/ota/check?ms={int(time.time() * 1000)}"',
        '"/ota/status"')],
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
