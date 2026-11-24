// Production ENV III unit and mutations of its board, transport and sampling boundaries.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourcePath = path.join(root, "main/env3.cpp");
const source = fs.readFileSync(sourcePath, "utf8");
assert.equal(process.argv.length, 2, "usage: node test/test_src_runtime.mjs");
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "daikin-src-runtime-"));
function execute(command, args, timeout = 30000) {
  const result = spawnSync(command, args, { cwd: root, encoding: "utf8", timeout, maxBuffer: 1024 * 1024 });
  assert.ifError(result.error);
  assert.equal(result.signal, null, `${command}: terminated\n${result.stdout}${result.stderr}`);
  return result;
}
function compile(name, override = sourcePath) {
  const binary = path.join(temp, name);
  const result = execute(process.env.CXX || "c++", [
    "-std=c++17", "-Wall", "-Wextra", "-Werror",
    '-DENV3_PRODUCTION_SOURCE=' + JSON.stringify(override),
    '-I' + path.join(root, "test/env3_runtime/stubs"),
    '-I' + path.join(root, "main"),
    path.join(root, "test/env3_runtime/fixture.cpp"), "-o", binary,
  ]);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  return binary;
}
function mutate(mutation) {
  assert.equal(source.split(mutation.before).length - 1, 1, mutation.name + ": source anchor must be unique");
  const mutated = path.join(temp, mutation.name + ".cpp");
  fs.writeFileSync(mutated, source.replace(mutation.before, mutation.after));
  return mutated;
}
const mutations = [
  {
    name: "env3-board-boundary", scenario: "board_start",
    before: "if (!cfg.env3_enabled || !env3_board_supported(cfg)) return;",
    after: "if (!cfg.env3_enabled) return;",
  },
  {
    name: "env3-probe-cleanup", scenario: "probe_success",
    before: "delete_bus(sensor);", after: "/* mutation: abandon short-lived probe handles */",
  },
  {
    name: "env3-probe-chip-id", scenario: "probe_chip_crc",
    before: "qmp_ok = read_reg(sensor.qmp, 0xd1, &chip_id, 1) == ESP_OK && chip_id == 0x5c;",
    after: "qmp_ok = read_reg(sensor.qmp, 0xd1, &chip_id, 1) == ESP_OK;",
  },
  {
    name: "env3-probe-crc", scenario: "probe_chip_crc",
    before: "sht_ok = env3_decode_sht30(raw, temperature, humidity);",
    after: "sht_ok = (static_cast<void>(env3_decode_sht30(raw, temperature, humidity)), true);",
  },
  {
    name: "env3-fresh-age", scenario: "sample_lifecycle",
    before: "age_us <= FRESH_US", after: "age_us <= FRESH_US + 1",
  },
  {
    // Restore the confirmed original task-start Config allocation. The adapter throws only on
    // that service snapshot, after env3_start has completed its own safe startup copy.
    name: "env3-task-config-allocation", scenario: "task_config_oom",
    before: "const TaskPins pins = *static_cast<const TaskPins*>(argument);",
    after: "(void)argument; const Config cfg = config(); const TaskPins pins{cfg.env3_sda, cfg.env3_scl};",
  },
];
try {
  const baseline = execute(compile("production-env3"), []);
  assert.equal(baseline.status, 0, baseline.stdout + baseline.stderr);
  assert.match(baseline.stdout, /PASS total=8\b/);
  console.log(baseline.stdout.trim());
  for (const mutation of mutations) {
    const result = execute(compile(mutation.name, mutate(mutation)), [mutation.scenario]);
    assert.equal(result.status, 1, `${mutation.name}: named oracle must reject mutation\n${result.stdout}${result.stderr}`);
    assert.match(result.stderr, new RegExp(`^FAIL ${mutation.scenario}:`, "m"));
    console.log(`negative control ${mutation.name}: rejected by ${mutation.scenario}`);
  }
  console.log("source runtime env3 sha256=" + createHash("sha256").update(source).digest("hex"));
  console.log("production ENV III runtime: 8 cases, " + mutations.length + " negative controls");
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}
