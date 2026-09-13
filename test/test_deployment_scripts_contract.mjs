import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function runScript(scriptName, args) {
  return new Promise((resolve) => {
    const proc = spawn(
      "bash",
      [path.join(root, "scripts", scriptName), ...args],
      { stdio: ["ignore", "pipe", "pipe"] }
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

// ---------------------------------------------------------------------------
// R2: A downgrade is permitted without the explicit option
// ---------------------------------------------------------------------------
{
  let postCount = 0;
  const mock = await createMockServer((req, res) => {
    if (req.url === "/status") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ version: "1.0.1", uptime_s: 100, app_elf_sha256: "aabbcc" }));
    } else if (req.url === "/ota/status") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        channel: "dev",
        busy: false,
        available: "1.0.0",
        update_available: false,
        downgrade: true,
        generation: 42,
        available_channel: "dev",
        available_sha256: "11223344",
      }));
    } else if (req.url.startsWith("/ota/check")) {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
    } else if (req.url.startsWith("/ota/update")) {
      postCount++;
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, generation: 42 }));
    } else {
      res.writeHead(404);
      res.end();
    }
  });

  try {
    // Without --allow-downgrade: must fail with exit 1 and ZERO update requests sent
    const res = await runScript("trigger-ota-wait.sh", ["--ip", `127.0.0.1:${mock.port}`, "--timeout", "2"]);
    assert.equal(res.status, 1, "downgrade without --allow-downgrade must exit 1");
    assert.match(res.stderr, /Manifest offers a downgrade/);
    assert.equal(postCount, 0, "must send zero update requests when downgrade is offered without permission");
  } finally {
    await mock.close();
  }
}

// ---------------------------------------------------------------------------
// R3: Expected-version validation happens after the write
// ---------------------------------------------------------------------------
{
  let postCount = 0;
  const mock = await createMockServer((req, res) => {
    if (req.url === "/status") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ version: "1.0.1", uptime_s: 100, app_elf_sha256: "aabbcc" }));
    } else if (req.url === "/ota/status") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        channel: "dev",
        busy: false,
        available: "1.0.2",
        update_available: true,
        downgrade: false,
        generation: 55,
        available_channel: "dev",
        available_sha256: "55667788",
      }));
    } else if (req.url.startsWith("/ota/check")) {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
    } else if (req.url.startsWith("/ota/update")) {
      postCount++;
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, generation: 55 }));
    } else {
      res.writeHead(404);
      res.end();
    }
  });

  try {
    // Expected version 1.0.3 when 1.0.2 is offered: must abort BEFORE sending POST
    const res = await runScript("trigger-ota-wait.sh", [
      "--ip", `127.0.0.1:${mock.port}`,
      "--expected-version", "1.0.3",
      "--timeout", "2",
    ]);
    assert.equal(res.status, 1, "expected version mismatch must exit 1");
    assert.match(res.stderr, /does not match requested expected version '1.0.3'/);
    assert.equal(postCount, 0, "must send zero update requests when offered version mismatches expected version");
  } finally {
    await mock.close();
  }
}

// ---------------------------------------------------------------------------
// R4: OTA reports success without the new image, no reboot, or pending rollback
// ---------------------------------------------------------------------------
{
  // 4a. No reboot (uptime unchanged, connection never dropped, returns old version)
  const mockNoReboot = await createMockServer((req, res) => {
    if (req.url === "/status") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ version: "1.0.1", uptime_s: 150, app_elf_sha256: "oldsha" }));
    } else if (req.url === "/ota/status") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        channel: "dev",
        busy: false,
        available: "1.0.2",
        update_available: true,
        downgrade: false,
        generation: 60,
        available_channel: "dev",
        available_sha256: "newsha",
        state: "done",
      }));
    } else if (req.url.startsWith("/ota/check")) {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
    } else if (req.url.startsWith("/ota/update")) {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, generation: 60 }));
    } else {
      res.writeHead(404);
      res.end();
    }
  });

  try {
    const res = await runScript("trigger-ota-wait.sh", [
      "--ip", `127.0.0.1:${mockNoReboot.port}`,
      "--timeout", "2",
    ]);
    assert.equal(res.status, 1, "no-reboot must fail");
    assert.match(res.stderr, /Device did not reboot after OTA update/);
  } finally {
    await mockNoReboot.close();
  }

  // 4b. Foreign generation in progress
  const mockForeignGen = await createMockServer((req, res) => {
    if (req.url === "/status") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ version: "1.0.1", uptime_s: 50, app_elf_sha256: "oldsha" }));
    } else if (req.url === "/ota/status") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        channel: "dev",
        busy: false,
        available: "1.0.2",
        update_available: true,
        downgrade: false,
        generation: 999, // foreign generation
        available_channel: "dev",
        available_sha256: "newsha",
        state: "downloading",
        progress: 10,
      }));
    } else if (req.url.startsWith("/ota/check")) {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
    } else if (req.url.startsWith("/ota/update")) {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, generation: 70 }));
    } else {
      res.writeHead(404);
      res.end();
    }
  });

  try {
    const res = await runScript("trigger-ota-wait.sh", [
      "--ip", `127.0.0.1:${mockForeignGen.port}`,
      "--timeout", "2",
    ]);
    assert.equal(res.status, 1, "foreign generation must fail");
    assert.match(res.stderr, /Observed foreign generation/);
  } finally {
    await mockForeignGen.close();
  }

  // 4c. Rollback pending after reboot
  let phase4c = "initial";
  const mockRollbackPending = await createMockServer((req, res) => {
    if (req.url === "/status") {
      res.writeHead(200, { "Content-Type": "application/json" });
      if (phase4c === "rebooted") {
        res.end(JSON.stringify({ version: "1.0.2", uptime_s: 2, app_elf_sha256: "newsha" }));
      } else {
        res.end(JSON.stringify({ version: "1.0.1", uptime_s: 100, app_elf_sha256: "oldsha" }));
      }
    } else if (req.url === "/ota/status") {
      res.writeHead(200, { "Content-Type": "application/json" });
      if (phase4c === "initial") {
        res.end(JSON.stringify({
          channel: "dev",
          busy: false,
          available: "1.0.2",
          update_available: true,
          downgrade: false,
          generation: 80,
          available_channel: "dev",
          available_sha256: "newsha",
        }));
      } else if (phase4c === "updating") {
        phase4c = "rebooted";
        res.end(JSON.stringify({ state: "done", generation: 80 }));
      } else {
        // Post-reboot: rollback_pending is true!
        res.end(JSON.stringify({
          image_state: "pending_verify",
          rollback_pending: true,
        }));
      }
    } else if (req.url.startsWith("/ota/check")) {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
    } else if (req.url.startsWith("/ota/update")) {
      phase4c = "updating";
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, generation: 80 }));
    } else {
      res.writeHead(404);
      res.end();
    }
  });

  try {
    const res = await runScript("trigger-ota-wait.sh", [
      "--ip", `127.0.0.1:${mockRollbackPending.port}`,
      "--timeout", "5",
    ]);
    assert.equal(res.status, 1, "rollback_pending=true must fail");
    assert.match(res.stderr, /rollback_pending=true/);
  } finally {
    await mockRollbackPending.close();
  }

  // 4d. Empty final status object ({}) after reboot
  let phase4d = "initial";
  const mockEmptyFinal = await createMockServer((req, res) => {
    if (req.url === "/status") {
      res.writeHead(200, { "Content-Type": "application/json" });
      if (phase4d === "rebooted") {
        res.end(JSON.stringify({ version: "1.0.2", uptime_s: 2, app_elf_sha256: "newsha" }));
      } else {
        res.end(JSON.stringify({ version: "1.0.1", uptime_s: 100, app_elf_sha256: "oldsha" }));
      }
    } else if (req.url === "/ota/status") {
      res.writeHead(200, { "Content-Type": "application/json" });
      if (phase4d === "initial") {
        res.end(JSON.stringify({
          channel: "dev",
          busy: false,
          available: "1.0.2",
          update_available: true,
          downgrade: false,
          generation: 85,
          available_channel: "dev",
          available_sha256: "newsha",
        }));
      } else if (phase4d === "updating") {
        phase4d = "rebooted";
        res.end(JSON.stringify({ state: "done", generation: 85 }));
      } else {
        res.end(JSON.stringify({})); // Empty final status
      }
    } else if (req.url.startsWith("/ota/check")) {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
    } else if (req.url.startsWith("/ota/update")) {
      phase4d = "updating";
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, generation: 85 }));
    } else {
      res.writeHead(404);
      res.end();
    }
  });

  try {
    const res = await runScript("trigger-ota-wait.sh", [
      "--ip", `127.0.0.1:${mockEmptyFinal.port}`,
      "--timeout", "5",
    ]);
    assert.equal(res.status, 1, "empty final status must fail");
    assert.match(res.stderr, /Timed out waiting for OTA image to reach valid state/);
  } finally {
    await mockEmptyFinal.close();
  }

  // 4e. Reboot into old version (device reboots, uptime decreases, but runs old version)
  let phase4e = "initial";
  const mockOldVersionReboot = await createMockServer((req, res) => {
    if (req.url === "/status") {
      res.writeHead(200, { "Content-Type": "application/json" });
      if (phase4e === "rebooted") {
        res.end(JSON.stringify({ version: "1.0.1", uptime_s: 2, app_elf_sha256: "oldsha" }));
      } else {
        res.end(JSON.stringify({ version: "1.0.1", uptime_s: 100, app_elf_sha256: "oldsha" }));
      }
    } else if (req.url === "/ota/status") {
      res.writeHead(200, { "Content-Type": "application/json" });
      if (phase4e === "initial") {
        res.end(JSON.stringify({
          channel: "dev",
          busy: false,
          available: "1.0.2",
          update_available: true,
          downgrade: false,
          generation: 90,
          available_channel: "dev",
          available_sha256: "newsha",
        }));
      } else if (phase4e === "updating") {
        phase4e = "rebooted";
        res.end(JSON.stringify({ state: "done", generation: 90 }));
      } else {
        res.end(JSON.stringify({ image_state: "valid", rollback_pending: false }));
      }
    } else if (req.url.startsWith("/ota/check")) {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
    } else if (req.url.startsWith("/ota/update")) {
      phase4e = "updating";
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, generation: 90 }));
    } else {
      res.writeHead(404);
      res.end();
    }
  });

  try {
    const res = await runScript("trigger-ota-wait.sh", [
      "--ip", `127.0.0.1:${mockOldVersionReboot.port}`,
      "--timeout", "5",
    ]);
    assert.equal(res.status, 1, "reboot into old version must fail");
    assert.match(res.stderr, /Version mismatch after OTA: expected selected offer '1.0.2', but device runs '1.0.1'/);
  } finally {
    await mockOldVersionReboot.close();
  }

  // 4f. Happy path OTA upgrade: progresses, reboots, settles with valid image
  let phase4f = "initial";
  const mockHappyPath = await createMockServer((req, res) => {
    if (req.url === "/status") {
      res.writeHead(200, { "Content-Type": "application/json" });
      if (phase4f === "rebooted") {
        res.end(JSON.stringify({ version: "1.0.2", uptime_s: 3, app_elf_sha256: "newsha" }));
      } else {
        res.end(JSON.stringify({ version: "1.0.1", uptime_s: 120, app_elf_sha256: "oldsha" }));
      }
    } else if (req.url === "/ota/status") {
      res.writeHead(200, { "Content-Type": "application/json" });
      if (phase4f === "initial") {
        res.end(JSON.stringify({
          channel: "dev",
          busy: false,
          available: "1.0.2",
          update_available: true,
          downgrade: false,
          generation: 95,
          available_channel: "dev",
          available_sha256: "newsha",
        }));
      } else if (phase4f === "updating") {
        phase4f = "rebooted";
        res.end(JSON.stringify({ state: "done", generation: 95 }));
      } else {
        res.end(JSON.stringify({ image_state: "valid", rollback_pending: false }));
      }
    } else if (req.url.startsWith("/ota/check")) {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
    } else if (req.url.startsWith("/ota/update")) {
      phase4f = "updating";
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, generation: 95 }));
    } else {
      res.writeHead(404);
      res.end();
    }
  });

  try {
    const res = await runScript("trigger-ota-wait.sh", [
      "--ip", `127.0.0.1:${mockHappyPath.port}`,
      "--expected-version", "1.0.2",
      "--timeout", "5",
    ]);
    assert.equal(res.status, 0, "happy path update must exit 0");
    assert.match(res.stdout, /OTA update accepted \(generation 95\)/);
  } finally {
    await mockHappyPath.close();
  }

  // 4g. Authorized downgrade with --allow-downgrade succeeds
  let phase4g = "initial";
  let receivedDowngradeParam = false;
  const mockAuthorizedDowngrade = await createMockServer((req, res) => {
    if (req.url === "/status") {
      res.writeHead(200, { "Content-Type": "application/json" });
      if (phase4g === "rebooted") {
        res.end(JSON.stringify({ version: "1.0.0", uptime_s: 2, app_elf_sha256: "downgradesha" }));
      } else {
        res.end(JSON.stringify({ version: "1.0.1", uptime_s: 200, app_elf_sha256: "currentsha" }));
      }
    } else if (req.url === "/ota/status") {
      res.writeHead(200, { "Content-Type": "application/json" });
      if (phase4g === "initial") {
        res.end(JSON.stringify({
          channel: "dev",
          busy: false,
          available: "1.0.0",
          update_available: false,
          downgrade: true,
          generation: 98,
          available_channel: "dev",
          available_sha256: "downgradesha",
        }));
      } else if (phase4g === "updating") {
        phase4g = "rebooted";
        res.end(JSON.stringify({ state: "done", generation: 98 }));
      } else {
        res.end(JSON.stringify({ image_state: "valid", rollback_pending: false }));
      }
    } else if (req.url.startsWith("/ota/check")) {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
    } else if (req.url.startsWith("/ota/update")) {
      phase4g = "updating";
      if (req.url.includes("downgrade=1")) {
        receivedDowngradeParam = true;
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, generation: 98 }));
    } else {
      res.writeHead(404);
      res.end();
    }
  });

  try {
    const res = await runScript("trigger-ota-wait.sh", [
      "--ip", `127.0.0.1:${mockAuthorizedDowngrade.port}`,
      "--allow-downgrade",
      "--timeout", "5",
    ]);
    assert.equal(res.status, 0, "authorized downgrade must exit 0");
    assert.ok(receivedDowngradeParam, "must include downgrade=1 parameter when --allow-downgrade is supplied");
  } finally {
    await mockAuthorizedDowngrade.close();
  }
}

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
        mqtt: { connected: true },
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
        mqtt: { connected: true },
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
        mqtt: { connected: true },
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
        mqtt: { connected: true },
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
        mqtt: { connected: true },
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
        mqtt: { connected: true },
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
        mqtt: { connected: true },
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
      res.end(JSON.stringify([{ id: "temp", value: 21.5 }]));
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

console.log("deployment scripts contract: R2, R3, R4, R5 offline scenarios clean");
