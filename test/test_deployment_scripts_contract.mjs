import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function runScript(scriptName, args, env = process.env) {
  return new Promise((resolve) => {
    const proc = spawn(
      "bash",
      [path.join(root, "scripts", scriptName), ...args],
      { stdio: ["ignore", "pipe", "pipe"], env }
    );
    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", (chunk) => { stdout += chunk; });
    proc.stderr.on("data", (chunk) => { stderr += chunk; });
    proc.on("close", (status) => {
      resolve({ status, stdout, stderr });
    });
  });
}

function createMockServer(handler) {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      handler(req, res);
    });
    server.listen(0, "127.0.0.1", () => {
      const port = server.address().port;
      resolve({
        port,
        close: () => new Promise((r) => server.close(r)),
      });
    });
  });
}

// The legacy helper is only an observer. Arguments that could select or start an update must
// fail before even a read, including malformed numeric input used in shell arithmetic.
{
  const requests = [];
  const mock = await createMockServer((req, res) => {
    requests.push([req.method, req.url]);
    res.writeHead(500);
    res.end();
  });
  const base = ["--ip", `127.0.0.1:${mock.port}`, "--expected-version", "1.0.2",
    "--generation", "77", "--quiet"];
  try {
    for (const args of [
      ["--channel", "dev"], ["--channel", "release"], ["--allow-downgrade"],
      ["--write"], ["--generation", "0"], ["--generation", "01"],
      ["--generation", "4294967296"], ["--generation", "1.5"],
      ["--generation", "x[1]"], ["--expected-version", ""],
      ["--ip", "127.0.0.1/status"], ["--ip", "user@127.0.0.1"],
      ["--ip", "127.0.0.1:0"], ["--ip", "127.0.0.1:99999"],
      ...["", "abc", "0", "-1", "1.5", "60s", "09", "99999", "x[1]"].map(
        timeout => ["--timeout", timeout]),
    ]) {
      requests.length = 0;
      const result = await runScript("trigger-ota-wait.sh", [...base, ...args]);
      assert.equal(result.status, 2, `invalid observer args ${JSON.stringify(args)}: ${result.stderr}`);
      assert.equal(requests.length, 0, "rejected arguments must never contact a device");
      if (["--channel", "--allow-downgrade"].includes(args[0])) {
        assert.match(result.stderr, /removed write option; use scripts\/production-ota-gate.py/);
      }
    }
    for (const args of [[], ["--ip", `127.0.0.1:${mock.port}`],
      ["--ip", `127.0.0.1:${mock.port}`, "--expected-version", "1.0.2"]]) {
      requests.length = 0;
      assert.equal((await runScript("trigger-ota-wait.sh", args)).status, 2);
      assert.equal(requests.length, 0, "missing operation binding must fail before contact");
    }
  } finally { await mock.close(); }
}

const oldImage = { version: "1.0.1", uptime_s: 100, app_elf_sha256: "oldelf123" };
const newImage = { version: "1.0.2", uptime_s: 2, app_elf_sha256: "newelf456" };
const active = { state: "updating", busy: true, generation: 77, current: "1.0.1",
  available: "1.0.2", progress: 20 };
const done = { ...active, state: "done", busy: false, progress: 100 };
const valid = { state: "", generation: 0, current: "1.0.2", image_state: "valid", rollback_pending: false };
const pending = { ...valid, image_state: "pending_verify", rollback_pending: true };

// Run the actual Bash helper and actual curl against loopback HTTP fixtures. Every scenario
// asserts the entire method/path history, so a hidden manifest check or configuration write fails.
async function observeCase(label, { statuses = [newImage], ota = [active, done, valid],
  statusCode = 200, otaCode = 200, expectedStatus = 1, expectedError = null } = {}) {
  const requests = [];
  let statusIndex = 0, otaIndex = 0, currentOta = ota[0];
  const mock = await createMockServer((req, res) => {
    requests.push([req.method, req.url]);
    const isStatus = req.url === "/status";
    const sequence = isStatus ? statuses : ota;
    const index = isStatus ? statusIndex++ : otaIndex++;
    const value = sequence[Math.min(index, sequence.length - 1)];
    if (!isStatus) currentOta = value;
    if (value === "disconnect") { req.socket.destroy(); return; }
    // Match production's full-status guard throughout the active network lease. Even a
    // healthy device returns 503 here until compact status records the validated new boot.
    const guardedStatus = currentOta.generation !== 0 || currentOta.image_state !== "valid";
    res.writeHead(isStatus ? (guardedStatus ? 503 : statusCode) : otaCode,
      { "Content-Type": "application/json" });
    res.end(JSON.stringify(value));
  });
  try {
    const result = await runScript("trigger-ota-wait.sh", ["--ip", `127.0.0.1:${mock.port}`,
      "--expected-version", "1.0.2", "--generation", "77", "--timeout",
      expectedError?.source.includes("Timed out") ? "2" : "5", "--quiet"]);
    assert.equal(result.status, expectedStatus, `${label}: ${result.stdout}${result.stderr}`);
    assert.ok(requests.length > 0, `${label}: fixture must be reached`);
    assert.deepEqual(requests[0], ["GET", "/ota/status"],
      "observation must start on compact status while full status is guarded");
    for (const [method, url] of requests) {
      assert.equal(method, "GET", `${label}: observer cannot write`);
      assert.ok(["/status", "/ota/status"].includes(url), `${label}: unexpected route ${url}`);
    }
    if (expectedError) assert.match(result.stderr, expectedError, label);
    if (expectedStatus === 0) {
      assert.match(result.stdout, /Observed generation 77 complete, a boot generation reset into 1.0.2, and valid image status/);
      assert.match(result.stdout, /Read-only observation/);
    }
  } finally { await mock.close(); }
}

await observeCase("completed existing canonical update while full status is guarded", { expectedStatus: 0 });
await observeCase("already completed transfer still requires a boot reset",
  { ota: [done, valid], expectedStatus: 0 });
await observeCase("pending rollback probation may settle normally",
  { ota: [active, done, pending, valid], expectedStatus: 0 });
await observeCase("same version is not fresh update evidence",
  { ota: [{ ...active, current: "1.0.2" }], expectedError: /already runs the expected version/ });
await observeCase("an available offer is not an accepted update",
  { ota: [{ ...active, state: "checked", busy: false }], expectedError: /No existing update matches/ });
await observeCase("wrong expected version",
  { ota: [{ ...active, available: "1.0.3" }], expectedError: /No existing update matches/ });
await observeCase("foreign generation",
  { ota: [active, { ...done, generation: 78 }], expectedError: /foreign or missing generation/ });
await observeCase("foreign generation after done",
  { ota: [active, done, { ...valid, generation: 78 }], expectedError: /foreign or missing generation/ });
await observeCase("new boot without completed writer receipt",
  { ota: [active, valid], expectedError: /new boot without the selected writer's completed verification/ });
await observeCase("failed update",
  { ota: [active, { ...active, state: "error", message: "verification failed" }],
    expectedError: /OTA failed on device: verification failed/ });
await observeCase("operation never completes",
  { ota: [active], expectedError: /Timed out observing/ });
await observeCase("version and ELF change alone are not reboot proof",
  { ota: [active, done], statuses: [newImage], expectedError: /Timed out observing/ });
await observeCase("disconnect alone is not reboot proof",
  { ota: [active, done, "disconnect", done], expectedError: /Timed out observing/ });
await observeCase("connection drop followed by a proved new boot",
  { ota: [active, done, "disconnect", valid], expectedStatus: 0 });
await observeCase("rollback into old firmware",
  { ota: [active, done, { ...valid, current: "1.0.1" }],
    expectedError: /Rebooted device does not report the expected version/ });
await observeCase("full status version disagrees with compact status",
  { statuses: [oldImage], expectedError: /Full device status disagrees/ });
await observeCase("probation never settles",
  { ota: [active, done, pending], expectedError: /Timed out observing/ });
await observeCase("missing generation",
  { ota: [active, done, {}], expectedError: /foreign or missing generation/ });
await observeCase("missing image state",
  { ota: [active, done, { generation: 0, current: "1.0.2" }], expectedError: /Timed out observing/ });
await observeCase("invalid image",
  { ota: [active, done, { ...valid, image_state: "invalid" }], expectedError: /marked 'invalid'/ });
await observeCase("valid status with rollback pending",
  { ota: [active, done, { ...valid, rollback_pending: true }], expectedError: /Timed out observing/ });
await observeCase("HTTP503 is not a successful post-reboot identity",
  { statusCode: 503, expectedError: /Timed out observing/ });
await observeCase("HTTP503 is not an accepted update receipt",
  { otaCode: 503, expectedError: /No existing update matches/ });
await observeCase("malformed identity",
  { statuses: [{ ...newImage, uptime_s: "2" }], expectedError: /Timed out observing/ });
await observeCase("missing ELF identity",
  { statuses: [{ ...newImage, app_elf_sha256: "" }], expectedError: /Timed out observing/ });
await observeCase("missing current version cannot establish a baseline",
  { ota: [{ ...active, current: null }], expectedError: /No existing update matches/ });

// ---------------------------------------------------------------------------
// R5: The health helper turns missing evidence into a green result
// ---------------------------------------------------------------------------
{
  // 5a. Original audit reproduction fixture: only version, wifi, mqtt
  const mockIncomplete = await createMockServer((req, res) => {
    if (req.url === "/status") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        version: "1.0.1",
        wifi: { connected: true },
        mqtt: { configured: true, connected: true },
      }));
    } else {
      res.writeHead(404);
      res.end();
    }
  });

  try {
    const res = await runScript("verify-device-health.sh", [
      "--ip", `127.0.0.1:${mockIncomplete.port}`,
      "--timeout", "2",
    ]);
    assert.equal(res.status, 1, "incomplete status must fail health check");
    assert.match(res.stderr, /Mandatory field 'app_elf_sha256' missing/);
    assert.match(res.stderr, /Mandatory field 'uptime_s' missing/);
    assert.match(res.stderr, /Mandatory field 'last_crash' missing/);
    assert.match(res.stderr, /Mandatory object 'sys' missing/);
  } finally {
    await mockIncomplete.close();
  }

  // 5b. Headroom below 10 KiB threshold must increment failures and fail
  const mockLowHeap = await createMockServer((req, res) => {
    if (req.url === "/status") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        version: "1.0.1",
        app_elf_sha256: "1122334455667788",
        uptime_s: 42,
        wifi: { connected: true },
        mqtt: { configured: true, connected: true },
        last_crash: null,
        sys: {
          safe_mode: false,
          free_heap: 25000,
          max_alloc: 8192, // < 10000
        },
      }));
    } else {
      res.writeHead(404);
      res.end();
    }
  });

  try {
    const res = await runScript("verify-device-health.sh", [
      "--ip", `127.0.0.1:${mockLowHeap.port}`,
      "--timeout", "2",
    ]);
    assert.equal(res.status, 1, "max_alloc below 10,000 B must fail");
    assert.match(res.stderr, /below 10,000 B minimum requirement/);
  } finally {
    await mockLowHeap.close();
  }

  // 5c. Valid clean boot with last_crash: null and healthy heap
  const mockCleanBoot = await createMockServer((req, res) => {
    if (req.url === "/status") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        version: "1.0.1",
        app_elf_sha256: "1122334455667788",
        uptime_s: 42,
        wifi: { connected: true },
        mqtt: { configured: true, connected: true },
        last_crash: null, // explicit clean boot
        sys: {
          safe_mode: false,
          free_heap: 35000,
          max_alloc: 24000,
        },
      }));
    } else {
      res.writeHead(404);
      res.end();
    }
  });

  try {
    const res = await runScript("verify-device-health.sh", [
      "--ip", `127.0.0.1:${mockCleanBoot.port}`,
      "--timeout", "2",
    ]);
    assert.equal(res.status, 0, "valid clean boot must pass");
    assert.match(res.stdout, /HEALTHY \(GREEN\)/);
  } finally {
    await mockCleanBoot.close();
  }

  // 5d. Active crash fault
  const mockCrashFault = await createMockServer((req, res) => {
    if (req.url === "/status") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        version: "1.0.1",
        app_elf_sha256: "1122334455667788",
        uptime_s: 42,
        wifi: { connected: true },
        mqtt: { configured: true, connected: true },
        last_crash: {
          fault: true,
          reason: "panic",
        },
        sys: {
          safe_mode: false,
          free_heap: 35000,
          max_alloc: 24000,
        },
      }));
    } else {
      res.writeHead(404);
      res.end();
    }
  });

  try {
    const res = await runScript("verify-device-health.sh", [
      "--ip", `127.0.0.1:${mockCrashFault.port}`,
      "--timeout", "2",
    ]);
    assert.equal(res.status, 1, "active crash fault must fail");
    assert.match(res.stderr, /Active crash fault detected/);
  } finally {
    await mockCrashFault.close();
  }

  // 5e. Safe mode active
  const mockSafeMode = await createMockServer((req, res) => {
    if (req.url === "/status") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        version: "1.0.1",
        app_elf_sha256: "1122334455667788",
        uptime_s: 42,
        wifi: { connected: true },
        mqtt: { configured: true, connected: true },
        last_crash: null,
        sys: {
          safe_mode: true,
          safe_mode_cause: "heap_exhaustion",
          free_heap: 35000,
          max_alloc: 24000,
        },
      }));
    } else {
      res.writeHead(404);
      res.end();
    }
  });

  try {
    const res = await runScript("verify-device-health.sh", [
      "--ip", `127.0.0.1:${mockSafeMode.port}`,
      "--timeout", "2",
    ]);
    assert.equal(res.status, 1, "safe mode must fail");
    assert.match(res.stderr, /Device is in safe mode! Cause: heap_exhaustion/);
  } finally {
    await mockSafeMode.close();
  }

  // 5f. --require-hp when hp.connected is false
  const mockHpDisconnected = await createMockServer((req, res) => {
    if (req.url === "/status") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        version: "1.0.1",
        app_elf_sha256: "1122334455667788",
        uptime_s: 42,
        wifi: { connected: true },
        mqtt: { configured: true, connected: true },
        last_crash: null,
        sys: {
          safe_mode: false,
          free_heap: 35000,
          max_alloc: 24000,
        },
        hp: {
          connected: false,
        },
      }));
    } else {
      res.writeHead(404);
      res.end();
    }
  });

  try {
    const res = await runScript("verify-device-health.sh", [
      "--ip", `127.0.0.1:${mockHpDisconnected.port}`,
      "--require-hp",
      "--timeout", "2",
    ]);
    assert.equal(res.status, 1, "--require-hp must fail when hp.connected is false");
    assert.match(res.stderr, /X10A Heat pump communication not connected/);
  } finally {
    await mockHpDisconnected.close();
  }

  // 5g. --require-hp when hp.connected is true and /values is valid
  const mockHpConnected = await createMockServer((req, res) => {
    if (req.url === "/status") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        version: "1.0.1",
        app_elf_sha256: "1122334455667788",
        uptime_s: 42,
        wifi: { connected: true },
        mqtt: { configured: true, connected: true },
        last_crash: null,
        sys: {
          safe_mode: false,
          free_heap: 35000,
          max_alloc: 24000,
        },
        hp: {
          connected: true,
          last_ok_s: 1,
        },
      }));
    } else if (req.url === "/values") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ values: [{ label: "Water temperature", value: "21.5", unit: "°C", reg: 96 }] }));
    } else {
      res.writeHead(404);
      res.end();
    }
  });

  try {
    const res = await runScript("verify-device-health.sh", [
      "--ip", `127.0.0.1:${mockHpConnected.port}`,
      "--require-hp",
      "--timeout", "2",
    ]);
    assert.equal(res.status, 0, "--require-hp must pass when hp.connected is true and /values has metrics");
    assert.match(res.stdout, /HEALTHY \(GREEN\)/);

    // 5h. Version mismatch
    const resVer = await runScript("verify-device-health.sh", [
      "--ip", `127.0.0.1:${mockHpConnected.port}`,
      "--expected-version", "9.9.9",
      "--timeout", "2",
    ]);
    assert.equal(resVer.status, 1, "expected version mismatch must fail");
    assert.match(resVer.stderr, /Version mismatch: expected '9.9.9', got '1.0.1'/);

    // 5i. ELF SHA mismatch
    const resElf = await runScript("verify-device-health.sh", [
      "--ip", `127.0.0.1:${mockHpConnected.port}`,
      "--expected-elf-sha", "ffffffff",
      "--timeout", "2",
    ]);
    assert.equal(resElf.status, 1, "expected ELF SHA mismatch must fail");
    assert.match(resElf.stderr, /ELF SHA mismatch: expected prefix 'ffffffff', got '1122334455667788'/);
  } finally {
    await mockHpConnected.close();
  }
}

// Contract-shaped X10A evidence: null is unavailable, textual values remain legitimate.
{
  const healthy = {
    version: "1.0.1", app_elf_sha256: "1122334455667788", uptime_s: 42,
    wifi: { connected: true }, mqtt: { configured: false, connected: false },
    last_crash: null, sys: { safe_mode: false, free_heap: 35000, max_alloc: 24000 },
    hp: { connected: true, last_ok_s: 1 },
  };
  const row = { label: "Water temperature", value: "21.5", unit: "°C", reg: 96 };
  let status = healthy, values = { values: [row] }, statusCode = 200, valuesCode = 200;
  const mock = await createMockServer((req, res) => {
    const isStatus = req.url === "/status";
    res.writeHead(isStatus ? statusCode : valuesCode, { "Content-Type": "application/json" });
    res.end(JSON.stringify(isStatus ? status : values));
  });
  const run = () => runScript("verify-device-health.sh", [
    "--ip", `127.0.0.1:${mock.port}`, "--require-hp", "--timeout", "0", "--quiet",
  ]);
  try {
    for (const value of ["21.5", "Normal", "0", "1"]) {
      values = { values: [{ ...row, value }], modbus: [] };
      assert.equal((await run()).status, 0, `real envelope value ${value} must pass`);
    }
    for (const payload of [[], {}, { values: [] }, { values: [{ ...row, value: null }] },
      { values: [{ ...row, value: "" }] }, { values: [{ ...row, value: "  " }] },
      { values: [{ ...row, value: {} }] }, { values: [{ ...row, value: [] }] },
      { values: [{ ...row, value: true }] }, { values: [{ ...row, value: 21.5 }] },
      { values: [{ ...row, value: "22", held: true }] },
      { values: [{ ...row, held: "true" }] }, { values: [{ ...row, held: null }] }, { values: [{ value: "22" }] }]) {
      values = payload;
      assert.equal((await run()).status, 1, `unusable/malformed values must fail: ${JSON.stringify(payload)}`);
    }
    values = { values: [row] };
    for (const mqtt of [{}, { configured: null }, { configured: "false" },
      { configured: true }, { configured: true, connected: "true" },
      { configured: true, connected: false }]) {
      status = { ...healthy, mqtt };
      assert.equal((await run()).status, 1, `missing/invalid MQTT evidence must fail: ${JSON.stringify(mqtt)}`);
    }
    for (const age of [undefined, null, -1, 15, 3600, "1", 1.5]) {
      status = { ...healthy, hp: { connected: true, last_ok_s: age } };
      assert.equal((await run()).status, 1, `missing/invalid/stale X10A age must fail: ${age}`);
    }
    for (const connected of ["true", 1, null, false]) {
      status = { ...healthy, hp: { connected, last_ok_s: 1 } };
      assert.equal((await run()).status, 1, `invalid/disconnected X10A state must fail: ${connected}`);
    }
    for (const field of ["free_heap", "max_alloc"]) {
      for (const value of [1.5, 4294967296, 1e100, "24000", null]) {
        status = { ...healthy, sys: { ...healthy.sys, [field]: value } };
        assert.equal((await run()).status, 1, `invalid ${field} must fail: ${value}`);
      }
    }
    status = healthy;
    valuesCode = 503;
    assert.equal((await run()).status, 1, "JSON received with HTTP503 is not successful evidence");
    valuesCode = 200;
    statusCode = 403;
    assert.equal((await run()).status, 1, "a valid status body received with HTTP403 must fail");
  } finally { await mock.close(); }

  // curl may have received HTTP200 before its transfer fails. Neither endpoint may hide exit28.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "daikin-health-transport-"));
  try {
    fs.writeFileSync(path.join(dir, "curl"), `#!/usr/bin/env node
const isStatus = process.argv.at(-1).endsWith('/status');
process.stdout.write((isStatus ? process.env.TEST_STATUS : process.env.TEST_VALUES) + '\\n200');
process.exit(isStatus ? +process.env.TEST_STATUS_EXIT : +process.env.TEST_VALUES_EXIT);
`, { mode: 0o755 });
    for (const [statusExit, valuesExit] of [[0, 0], [28, 0], [0, 28]]) {
      const result = await runScript("verify-device-health.sh", [
        "--ip", "synthetic.invalid", "--require-hp", "--timeout", "0", "--quiet",
      ], { ...process.env, PATH: `${dir}:${process.env.PATH}`,
        TEST_STATUS: JSON.stringify(healthy), TEST_VALUES: JSON.stringify({ values: [row] }),
        TEST_STATUS_EXIT: String(statusExit), TEST_VALUES_EXIT: String(valuesExit) });
      assert.equal(result.status, statusExit || valuesExit ? 1 : 0,
        `HTTP200 plus curl exits ${statusExit}/${valuesExit} must retain transport outcome`);
    }
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }

  // --timeout bounds retries, not the first request. This clock advances one second on every read,
  // so a deadline check before the first request would already be past a zero timeout.
  const clockDir = fs.mkdtempSync(path.join(os.tmpdir(), "daikin-health-clock-"));
  try {
    fs.writeFileSync(path.join(clockDir, "date"), `#!/usr/bin/env node
const fs = require('fs');
let n = 0;
try { n = +fs.readFileSync(process.env.TEST_CLOCK, 'utf8'); } catch {}
fs.writeFileSync(process.env.TEST_CLOCK, String(n + 1));
process.stdout.write(String(1700000000 + n) + '\\n');
`, { mode: 0o755 });
    fs.writeFileSync(path.join(clockDir, "curl"), `#!/usr/bin/env node
require('fs').appendFileSync(process.env.TEST_REQUESTS, process.argv.at(-1) + '\\n');
process.stdout.write(process.env.TEST_STATUS + '\\n200');
process.exit(+process.env.TEST_CURL_EXIT);
`, { mode: 0o755 });
    fs.writeFileSync(path.join(clockDir, "sleep"), "#!/bin/sh\nexit 0\n", { mode: 0o755 });
    const clock = path.join(clockDir, "clock");
    const requests = path.join(clockDir, "requests");
    const runClocked = (timeout, curlExit) => {
      fs.rmSync(clock, { force: true });
      fs.writeFileSync(requests, "");
      return runScript("verify-device-health.sh", [
        "--ip", "synthetic.invalid", "--timeout", timeout, "--quiet",
      ], { ...process.env, PATH: `${clockDir}:${process.env.PATH}`, TEST_CLOCK: clock,
        TEST_REQUESTS: requests, TEST_STATUS: JSON.stringify(healthy),
        TEST_CURL_EXIT: String(curlExit) });
    };
    const requestCount = () => fs.readFileSync(requests, "utf8").split("\n").filter(Boolean).length;
    let result = await runClocked("0", 0);
    assert.equal(result.status, 0, `a healthy board must pass under --timeout 0: ${result.stderr}`);
    assert.equal(requestCount(), 1, "--timeout 0 must make exactly one /status request");
    result = await runClocked("0", 7);
    assert.equal(result.status, 1, "an unreachable board must fail under --timeout 0");
    assert.equal(requestCount(), 1, "an unreachable board must still be asked once");
    for (const timeout of ["09", "010"]) {
      result = await runClocked(timeout, 0);
      assert.equal(result.status, 0, `--timeout ${timeout} is a decimal number of seconds: ${result.stderr}`);
    }
    for (const timeout of ["", "abc", "-1", "1.5", "60s"]) {
      result = await runClocked(timeout, 0);
      assert.equal(result.status, 2, `malformed --timeout ${JSON.stringify(timeout)} is a usage error`);
      assert.equal(requestCount(), 0, `malformed --timeout ${JSON.stringify(timeout)} must not contact the board`);
    }
  } finally { fs.rmSync(clockDir, { recursive: true, force: true }); }
}

console.log("deployment scripts contract: read-only OTA observer and R5 health scenarios clean");
