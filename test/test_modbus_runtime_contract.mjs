// Compile the entire current production Modbus component and execute it over real POSIX sockets.
// SDK-shaped adapters provide an explicit clock and task schedule; see modbus_runtime/README.md.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fixture = path.join(root, "test/modbus_runtime/fixture.cpp");
const sourcePath = path.join(root, "main/hp_modbus.cpp");
const source = fs.readFileSync(sourcePath, "utf8");
const sourceHash = createHash("sha256").update(source).digest("hex");
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "daikin-modbus-runtime-"));
const compiler = process.env.CXX || "c++";

function execute(command, args, timeout = 30000) {
  const result = spawnSync(command, args, {
    cwd: root, encoding: "utf8", timeout, maxBuffer: 1024 * 1024,
  });
  assert.ifError(result.error);
  assert.equal(result.signal, null, `${command} was terminated: ${result.stdout}${result.stderr}`);
  return result;
}

function compile(production, name) {
  const binary = path.join(dir, name);
  const result = execute(compiler, [
    "-std=c++17", "-pthread", "-Wall", "-Wextra", "-Werror",
    `-DHUB_PRODUCTION_SOURCE=${JSON.stringify(production)}`,
    `-I${path.join(root, "test/modbus_runtime/stubs")}`,
    `-I${path.join(root, "main")}`, fixture, "-o", binary,
  ]);
  assert.equal(result.status, 0, `${name}: full production TU must compile\n${result.stdout}${result.stderr}`);
  return binary;
}

function mutateOnce(before, after, name) {
  const count = typeof before === "string"
    ? source.split(before).length - 1
    : [...source.matchAll(new RegExp(before.source, before.flags + "g"))].length;
  assert.equal(count, 1, `${name}: mutation anchor must be unique`);
  const mutated = path.join(dir, `${name}.cpp`);
  fs.writeFileSync(mutated, source.replace(before, after));
  return mutated;
}

try {
  const binary = compile(sourcePath, "production");
  const baseline = execute(binary, [], 20000);
  assert.equal(baseline.status, 0, `production runtime cases\n${baseline.stdout}${baseline.stderr}`);
  assert.match(baseline.stdout, /PASS total=21\b/);
  console.log(baseline.stdout.trim());

  // A successfully compiled mutation must fail its particular behavioral oracle. A crash,
  // compilation failure or another test failure cannot count as evidence that the oracle works.
  const mutations = [
    {
      name: "receive-deadline", scenario: "deadline",
      before: "if (esp_timer_get_time() >= deadline_us) {",
      after: "if (((void)deadline_us, false)) {",
    },
    {
      name: "transaction-echo", scenario: "transaction",
      before: "mb_parse_response(io.adu, got, txn, unit, space, qty, out)",
      after: "mb_parse_response(io.adu, got, static_cast<uint16_t>((io.adu[0] << 8) | io.adu[1]), unit, space, qty, out)",
    },
    {
      name: "session-generation", scenario: "snapshot_generation",
      before: "cache_generation, target_generation,",
      after: "((void)cache_generation, s_link_generation), target_generation,",
    },
    {
      name: "target-profile", scenario: "profile_cutover",
      before: /^ {8}s_status\.profile\s*= ModbusProfile::Auto;$/m,
      after: "/* mutation: retain the previous target's profile */",
    },
    {
      name: "target-profile-basis", scenario: "profile_cutover",
      before: /^ {8}s_status\.profile_basis\s*= ModbusProfileBasis::Probing;$/m,
      after: "/* mutation: retain the previous target's profile basis */",
    },
    {
      name: "public-profile-authority", scenario: "reconfigure_generations",
      before: "return s_status.profile;",
      after: "return s_active_profile.load(std::memory_order_acquire);",
    },
    ...[{ name: "full", indent: 8 }, { name: "fast", indent: 12 }].map(({ name, indent }) => ({
      name: `${name}-status-target-generation`, scenario: "poll_cutover",
      before: new RegExp(`^ {${indent}}if \\(s_target_generation\\.load\\(std::memory_order_acquire\\) == cycle_target_generation\\) \\{\n {${indent + 4}}s_status\\.profile[^\n]+`, "m"),
      after: match => match.replace("if (s_target_generation.load(std::memory_order_acquire) == cycle_target_generation)", "if (true)"),
    })),
    {
      name: "zero-cache-time", scenario: "zero_cache_commit",
      before: "logic::modbus_observation_age_s(s_cache_commit_ms, esp_timer_get_time() / 1000)",
      after: "(s_cache_commit_ms == 0 ? UINT32_MAX : logic::modbus_observation_age_s(s_cache_commit_ms, esp_timer_get_time() / 1000))",
    },
    {
      name: "status-cache-age", scenario: "cache_count",
      before: "logic::modbus_observation_age_s(s_full_cache_status_ms, now_ms)",
      after: "0",
    },
    {
      name: "fallback-watchdog", scenario: "fallback_watchdog",
      before: "esp_task_wdt_reset();\n    const int sent = send(s_sock, req, n, 0);",
      after: "const int sent = send(s_sock, req, n, 0);",
    },
    ...["s_plant_gate_ms", "s_heating_mode_ms", "s_plant_outdoor_ms"].map(timestamp => ({
      name: `observation-age-${timestamp}`, scenario: "gate_age",
      before: `logic::modbus_observation_age_s(${timestamp}, now_ms)`,
      after: "logic::modbus_observation_age_s(s_last_reply_ms, now_ms)",
    })),
    ...[{ member: "s_heating_mode_ms", local: "heating_mode_ms" },
      { member: "s_plant_outdoor_ms", local: "plant_outdoor_ms" }].map(({ member, local }) => ({
      name: `completed-sweep-${member}`, scenario: "gate_age",
      before: new RegExp(`^ {8}${member}\\s*= final_current_session \\? ${local} : -1;`, "m"),
      after: `${member} = final_current_session ? cache_commit_ms : -1;`,
    })),
    {
      name: "discovery-attempt-budget", scenario: "discovery_budget",
      before: /const int\s+lookup_ms = remaining_ms > 2000 \? 2000 : static_cast<int>\(remaining_ms\);/,
      after: "const int lookup_ms = ((void)remaining_ms, 2000);",
    },
  ];
  for (const mutation of mutations) {
    const mutated = mutateOnce(mutation.before, mutation.after, mutation.name);
    const mutant = compile(mutated, mutation.name);
    const result = execute(mutant, [mutation.scenario], 10000);
    assert.equal(result.status, 1, `${mutation.name}: behavioral oracle must reject the mutation\n${result.stdout}${result.stderr}`);
    assert.match(result.stderr, new RegExp(`^FAIL ${mutation.scenario}:`, "m"),
      `${mutation.name}: only its specific assertion failure counts`);
    console.log(`negative control ${mutation.name}: rejected by ${mutation.scenario}`);
  }
  console.log(`production Modbus runtime: 21 cases, ${mutations.length} negative controls; source sha256=${sourceHash}`);
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}
