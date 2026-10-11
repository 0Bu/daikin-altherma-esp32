import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { launchBrowser } from "./cdp_browser.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const work = fs.mkdtempSync(path.join(os.tmpdir(), "daikin-browser-cleanup-selftest-"));
const originalBrowser = process.env.DAIKIN_BROWSER_BIN;
const active = (pid) => {
  const result = spawnSync("ps", ["-p", String(pid), "-o", "stat="], { encoding: "utf8" });
  return result.status === 0 && result.stdout.trim() && !result.stdout.trim().startsWith("Z");
};
async function until(check, label, timeout = 3000) {
  const end = Date.now() + timeout;
  while (!check()) {
    assert.ok(Date.now() < end, label);
    await pause(20);
  }
}
function stopped(child, timeout = 8000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error("fixture runner did not exit before its watchdog"));
    }, timeout);
    child.once("error", reject);
    child.once("exit", (code, signal) => { clearTimeout(timer); resolve({ code, signal }); });
  });
}
const shellQuote = (value) => `'${value.replaceAll("'", "'\\''")}'`;

// A real local HTTP/WebSocket child acts as Chrome's DevTools endpoint. It deliberately stalls
// before headers, after headers, during the WebSocket upgrade, or in /json/version after CDP.
const browserShim = path.join(work, "fake-chrome");
fs.writeFileSync(browserShim,
  `#!/bin/sh\nset -eu\nexec ${shellQuote(process.execPath)} ${shellQuote(path.join(root, "tools/browser/stalled_browser_fixture.mjs"))} "$@"\n`, { mode: 0o755 });
try {
  for (const mode of ["list-headers", "list-body", "socket", "version-headers", "version-body"]) {
    const marker = path.join(work, `${mode}.json`);
    process.env.DAIKIN_BROWSER_BIN = browserShim;
    process.env.DAIKIN_BROWSER_STALL_MODE = mode;
    process.env.DAIKIN_BROWSER_STALL_MARKER = marker;
    const before = Date.now();
    await assert.rejects(launchBrowser({ timeoutMs: 600 }), /Chrome launch deadline exceeded/,
      `${mode}: stalled endpoint must fail at the single launch deadline`);
    assert.ok(Date.now() - before < 2500, `${mode}: headers and body must have bounded completion`);
    const recorded = JSON.parse(fs.readFileSync(marker, "utf8"));
    assert.equal(Boolean(active(recorded.pid)), false, `${mode}: browser child must be joined`);
    assert.equal(fs.existsSync(recorded.profile), false, `${mode}: profile must be removed after join`);
    if (mode === "version-headers" || mode === "version-body") {
      assert.ok(recorded.versionReached, `${mode}: fixture must reach /json/version after CDP enable`);
    }
    console.log(`browser cleanup selftest: ${mode} launch deadline and cleanup observed`);
  }

  const signalMarker = path.join(work, "signal.json");
  const library = path.join(root, "tools/browser/cdp_browser.mjs");
  const interrupted = spawn(process.execPath, ["--input-type=module", "-e",
    `import { launchBrowser } from ${JSON.stringify(library)}; await launchBrowser();`], {
    env: { ...process.env, DAIKIN_BROWSER_BIN: browserShim,
      DAIKIN_BROWSER_STALL_MODE: "list-headers", DAIKIN_BROWSER_STALL_MARKER: signalMarker },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let interruptedOutput = "";
  interrupted.stdout.on("data", (chunk) => { interruptedOutput += chunk; });
  interrupted.stderr.on("data", (chunk) => { interruptedOutput += chunk; });
  const interruptedExit = stopped(interrupted);
  await until(() => fs.existsSync(signalMarker), "signal fixture must own a launched browser");
  interrupted.kill("SIGTERM");
  const signalExit = await interruptedExit;
  assert.equal(signalExit.code, 143, interruptedOutput);
  const signalRecord = JSON.parse(fs.readFileSync(signalMarker, "utf8"));
  assert.equal(Boolean(active(signalRecord.pid)), false, "signal cleanup must join browser child");
  assert.equal(fs.existsSync(signalRecord.profile), false, "signal cleanup must remove profile last");

  // Exercise the real render entrypoint's handled setup failure rather than relying on Node's
  // uncaught-ESM exit behavior. A non-browser executable exits before exposing any endpoint.
  const deadBrowser = path.join(work, "dead-chrome");
  fs.writeFileSync(deadBrowser, "#!/bin/sh\nset -eu\nexit 7\n", { mode: 0o755 });
  const page = path.join(work, "index.html");
  fs.writeFileSync(page, "<!doctype html><title>setup-only fixture</title>");
  const setup = spawnSync(process.execPath, [path.join(root, "test/test_browser_render.mjs")], {
    cwd: root, encoding: "utf8", timeout: 5000,
    env: { ...process.env, DAIKIN_BROWSER_BIN: deadBrowser, DAIKIN_BROWSER_PAGE: page },
  });
  assert.equal(setup.status, 2, `browser setup must close its fixture server and exit 2\n${setup.stderr}`);
  assert.match(setup.stderr, /browser render setup: Chrome exited before DevTools/);
  console.log("browser cleanup selftest: signal cleanup and actual render setup exit 2 observed");
} finally {
  if (originalBrowser === undefined) delete process.env.DAIKIN_BROWSER_BIN;
  else process.env.DAIKIN_BROWSER_BIN = originalBrowser;
  delete process.env.DAIKIN_BROWSER_STALL_MODE;
  delete process.env.DAIKIN_BROWSER_STALL_MARKER;
  fs.rmSync(work, { recursive: true, force: true });
}
