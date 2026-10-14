// Execute the full production deadline TU, then reject defenses removed from temporary sources.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fixture = path.join(root, "test/http_deadline_runtime/fixture.cpp");
const production = path.join(root, "main/http_deadline.cpp");
const source = fs.readFileSync(production, "utf8");
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "daikin-http-deadline-runtime-"));
const originalCommit = "26e9bffd3a9a33181e2f3af1b0cc405cca64ae39";
const scenarios = [
  "init_success", "prime_null", "prime_unregistered", "prime_lost",
  "init_sem_1", "init_sem_2", "init_sem_3", "init_task", "init_timeout", "init_timer",
  "arm_validation", "arm_budget", "arm_elapsed", "arm_wrap", "arm_start_error", "arm_owner_busy",
  "stop_success", "queued_expiry", "running_expiry", "stale_ack", "elapsed_disarm",
  "destructor_stop", "destructor_expiry", "shutdown_enotconn",
  "stop_error", "owner_mismatch", "missing_watchdog",
  "shutdown_error_enomem", "shutdown_error_ebadf", "shutdown_error_other", "ack_error",
];

function execute(command, args, timeout = 30000) {
  const result = spawnSync(command, args, { cwd: root, encoding: "utf8", timeout, maxBuffer: 1024 * 1024 });
  assert.ifError(result.error);
  assert.equal(result.signal, null, `${command}: an unexplained crash never counts\n${result.stdout}${result.stderr}`);
  return result;
}
function compile(file, name, legacy = false) {
  const binary = path.join(dir, name);
  const result = execute(process.env.CXX || "c++", [
    "-std=c++17", "-pthread", "-Wall", "-Wextra", "-Werror",
    `-DHTTP_DEADLINE_PRODUCTION_SOURCE=${JSON.stringify(file)}`,
    ...(legacy ? ["-DHTTP_DEADLINE_LEGACY_PRIME=1"] : []),
    `-I${path.join(root, "test/http_deadline_runtime/stubs")}`,
    `-I${path.join(root, "main")}`, fixture, "-o", binary,
  ]);
  assert.equal(result.status, 0, `${name}: complete production TU must compile\n${result.stdout}${result.stderr}`);
  return binary;
}
function rejected(binary, scenario, name) {
  const result = execute(binary, [scenario], 10000);
  assert.equal(result.status, 1, `${name}: behavioral oracle must reject\n${result.stdout}${result.stderr}`);
  assert.match(result.stderr, new RegExp(`^ASSERT ${scenario}:`, "m"),
    `${name}: only the selected scenario's assertion counts`);
  console.log(`negative control ${name}: rejected by ${scenario}`);
}
function replaceOnce(before, after, name) {
  assert.equal(source.split(before).length - 1, 1, `${name}: unique mutation anchor required`);
  return source.replace(before, after);
}

try {
  const baseline = compile(production, "production");
  for (const scenario of scenarios) {
    const result = execute(baseline, [scenario], 10000);
    assert.equal(result.status, 0, `production ${scenario}\n${result.stdout}${result.stderr}`);
    assert.match(result.stdout, /^PASS (?:fail_closed|[a-z0-9_]+)\n$/);
    console.log(`production ${scenario}: passed`);
  }

  // Immutable original source supplies a real before-fix control. It must also pass ordinary
  // stop/disarm, proving rejection is specific to unretained TLS registration rather than the
  // fixture merely insisting that the new second lookup exists.
  const original = execute("git", ["-c", "core.fsmonitor=false", "show", `${originalCommit}:main/http_deadline.cpp`]);
  assert.equal(original.status, 0, "original-source regression control requires the retained repository commit");
  const originalPath = path.join(dir, "original.cpp");
  fs.writeFileSync(originalPath, original.stdout);
  const originalBinary = compile(originalPath, "original", true);
  const originalPositive = execute(originalBinary, ["stop_success"], 10000);
  assert.equal(originalPositive.status, 0, `original-source positive control\n${originalPositive.stdout}${originalPositive.stderr}`);
  assert.match(originalPositive.stdout, /^PASS stop_success\n$/);
  rejected(originalBinary, "prime_unregistered", "original-unregistered-prime");
  console.log(`original source ${originalCommit}: ordinary stop passed; sha256=`
    + createHash("sha256").update(original.stdout).digest("hex"));

  const mutations = [
    {
      name: "null-prime-readiness", scenario: "prime_null",
      before: "thread_sem != nullptr && sys_thread_sem_get() == thread_sem",
      after: "(static_cast<void>(thread_sem), true)",
    },
    {
      name: "operation-budget-reset", scenario: "arm_budget",
      before: "static_cast<uint64_t>(remaining), static_cast<uint64_t>(portTICK_PERIOD_MS)",
      after: "static_cast<uint64_t>(duration), static_cast<uint64_t>(portTICK_PERIOD_MS)",
    },
    {
      name: "competing-owner", scenario: "arm_owner_busy",
      before: "if (!owner_lock || s_deadline.owner != nullptr) return ESP_ERR_INVALID_STATE;",
      after: "if (!owner_lock) return ESP_ERR_INVALID_STATE;",
    },
    {
      name: "stale-ack-drain", scenario: "stale_ack",
      before: "while (xSemaphoreTake(s_deadline.completion, 0) == pdTRUE) {}",
      after: "/* mutation: leave previous acknowledgement pending */",
    },
    {
      name: "queued-ack-join", scenario: "queued_expiry",
      before: "(void)xSemaphoreTake(s_deadline.completion, portMAX_DELAY);",
      after: "/* mutation: release descriptor without joining shutdown */",
    },
    {
      name: "running-ack-join", scenario: "running_expiry",
      before: "(void)xSemaphoreTake(s_deadline.completion, portMAX_DELAY);",
      after: "/* mutation: release descriptor without joining shutdown */",
    },
    {
      name: "timer-stop-fail-closed", scenario: "stop_error",
      before: "} else if (stop_err != ESP_OK) {",
      after: "} else if (stop_err == ESP_OK) {",
    },
    {
      name: "shutdown-fail-closed", scenario: "shutdown_error_enomem",
      before: "if (shutdown_result != 0 && shutdown_errno != ENOTCONN) {",
      after: "if ((static_cast<void>(shutdown_result), static_cast<void>(shutdown_errno), false)) {",
    },
    {
      name: "timer-callback-allocation", scenario: "running_expiry",
      before: "void socket_deadline_expired(void*) noexcept {",
      after: "void socket_deadline_expired(void*) noexcept {\n"
        + "    void* memory = ::operator new(32); ::operator delete(memory);",
    },
    {
      name: "descriptor-withdrawal", scenario: "stop_success",
      before: "s_deadline.socket.store(-1, std::memory_order_release);\n    s_deadline.owner = nullptr;",
      after: "/* mutation: leave descriptor published after disarm */\n    s_deadline.owner = nullptr;",
    },
    {
      name: "fresh-expiry-generation", scenario: "running_expiry",
      before: "s_deadline.fired.store(false, std::memory_order_release);",
      after: "/* mutation: retain previous expiry for next generation */",
    },
    {
      name: "destructor-disarm", scenario: "destructor_stop",
      before: "HttpSocketDeadline::~HttpSocketDeadline() { (void)disarm(); }",
      after: "HttpSocketDeadline::~HttpSocketDeadline() {}",
    },
  ];
  for (const mutation of mutations) {
    const mutated = path.join(dir, `${mutation.name}.cpp`);
    fs.writeFileSync(mutated, replaceOnce(mutation.before, mutation.after, mutation.name));
    rejected(compile(mutated, mutation.name), mutation.scenario, mutation.name);
  }
  console.log(`production HTTP deadline runtime: ${scenarios.length} cases, ${mutations.length + 1} negative controls; source sha256=`
    + createHash("sha256").update(source).digest("hex"));
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}
