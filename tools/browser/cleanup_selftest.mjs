import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const work = fs.mkdtempSync(path.join(os.tmpdir(), "daikin-browser-cleanup-selftest-"));
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
  for (const [name, mode, delay = 0, control, expected] of [
    ...["list-headers", "list-body", "socket", "version-headers", "version-body"].map(mode => [mode, mode]),
    ["delayed-version", "version-headers", 750],
    ["early-before-version", "version-headers", 0, "--expire-before-endpoint", /endpoint stall before arming deadline/],
    ["missing-body-witness", "version-body", 0, "--suppress-body-witness", /body-reader stall before arming deadline/],
    ["missing-stall-witness", "socket", 0, "--suppress-stall-witness", /endpoint stall before arming deadline/],
  ]) {
    const marker = path.join(work, `${name}.json`);
    const runner = spawn(process.execPath, [path.join(root, "tools/browser/cleanup_deadline_case.mjs"),
      ...(control ? [control] : [])], {
      env: { ...process.env, DAIKIN_BROWSER_BIN: browserShim, DAIKIN_BROWSER_STALL_MODE: mode,
        DAIKIN_BROWSER_STALL_MARKER: marker, DAIKIN_BROWSER_STALL_STARTUP_DELAY_MS: String(delay),
        DAIKIN_BROWSER_STALL_HOLD_ENDPOINT: control === "--expire-before-endpoint" ? "1" : "0" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    runner.stdout.on("data", chunk => { output += chunk; });
    runner.stderr.on("data", chunk => { output += chunk; });
    try {
      const completion = await stopped(runner);
      const line = output.split("\n").find(line => line.startsWith("DEADLINE_CASE:"));
      assert.ok(line, `${name}: isolated deadline fixture must report its observation\n${output}`);
      const result = JSON.parse(line.slice("DEADLINE_CASE:".length));
      assert.equal(result.cleanupVerified, true, `${name}: actual child/profile cleanup must pass\n${output}`);
      assert.equal(result.deadlineRejected, true, `${name}: actual launch deadline must reject\n${output}`);
      assert.equal(result.timers, 1, `${name}: one absolute timer must be registered`);
      assert.equal(result.delay, 600, `${name}: the launch timer must remain 600 ms`);
      assert.equal(result.deadlineFired, true, `${name}: the captured production deadline must fire`);
      assert.equal(result.cancelledBeforeFiring, false, `${name}: the deadline must not be reset or cancelled early`);
      if (control === "--expire-before-endpoint") {
        assert.equal(result.endpointReady, true, "early control must own its actual held endpoint");
        assert.equal(result.actualStall, null, "early expiry must precede the intended version stall");
        assert.deepEqual(result.enabled, [], "early expiry must precede CDP enable");
      } else {
        assert.equal(result.actualStall, mode, `${name}: raw observation must reach its own stall`);
        if (mode.endsWith("-body"))
          assert.ok(result.bodyRead.includes(mode === "list-body" ? "/json/list" : "/json/version"),
            `${name}: raw observation must enter the actual JSON body reader`);
        if (mode.startsWith("version-"))
          assert.ok(["Page.enable", "Runtime.enable", "Log.enable", "Accessibility.enable"].every(method =>
            result.enabled.includes(method)), `${name}: all actual CDP domains must be enabled`);
      }
      assert.equal(completion.code, expected ? 1 : 0, `${name}: unexpected fixture result\n${output}`);
      assert.equal(result.armed, !expected, `${name}: only the requested stall may arm the deadline`);
      if (expected) assert.match(output, expected, `${name}: control must fail for its intended setup witness`);
      console.log(`browser cleanup selftest: ${name} stall arming, deadline and cleanup observed`);
    } finally {
      const recorded = fs.existsSync(marker) ? JSON.parse(fs.readFileSync(marker, "utf8")) : {};
      for (const pid of [runner.pid, recorded.pid].filter(Number.isInteger)) {
        if (active(pid)) process.kill(pid, "SIGKILL");
        await until(() => !active(pid), `${name}: owned fixture PID ${pid} must be cleaned`);
      }
      if (recorded.profile) {
        assert.equal(path.dirname(recorded.profile), os.tmpdir());
        assert.match(path.basename(recorded.profile), /^daikin-browser-gate-[A-Za-z0-9]+$/);
        fs.rmSync(recorded.profile, { recursive: true, force: true });
      }
    }
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

  // A browser helper can inherit both pipes and outlive the browser's main process. An exited
  // main PID is therefore not EOF: the owning Node must release its pipe handles to exit naturally.
  const inheritedMain = path.join(work, "inherited-stdio-main.mjs");
  fs.writeFileSync(inheritedMain, `
    import fs from 'node:fs';
    import { spawn } from 'node:child_process';
    const marker = process.env.DAIKIN_BROWSER_STDIO_MARKER;
    const writer = spawn(process.execPath, ['-e',
      'require("node:fs").writeFileSync(' + JSON.stringify(marker + '.writer') +
      ', "ready"); setInterval(() => {}, 1000);'], { stdio: ['ignore', 1, 2] });
    writer.unref();
    fs.writeFileSync(marker, JSON.stringify({ pid: process.pid, writer: writer.pid,
      profile: process.argv.find(arg => arg.startsWith('--user-data-dir='))?.slice(16) }));
    console.log('owned stdout before main exit');
    console.error('owned stderr before main exit');
    const wait = () => {
      if (fs.existsSync(marker + '.exit')) process.exit(
        process.env.DAIKIN_BROWSER_STDIO_MODE === 'launch-error' ? 7 : 0);
      setTimeout(wait, 10);
    };
    wait();
  `);
  const inheritedBrowser = path.join(work, "inherited-stdio-chrome");
  fs.writeFileSync(inheritedBrowser,
    `#!/bin/sh\nset -eu\nexec ${shellQuote(process.execPath)} ${shellQuote(inheritedMain)} "$@"\n`,
    { mode: 0o755 });
  for (const mode of ["already-exited", "terminated", "launch-error"]) {
    const marker = path.join(work, `inherited-${mode}.json`);
    const runner = spawn(process.execPath, ["--input-type=module", "-e", `
      import assert from 'node:assert/strict';
      import fs from 'node:fs';
      import { spawn } from 'node:child_process';
      import { launchBrowser, stopBrowser } from ${JSON.stringify(library)};
      const marker = process.env.DAIKIN_BROWSER_STDIO_MARKER;
      const mode = process.env.DAIKIN_BROWSER_STDIO_MODE;
      const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
      const until = async check => {
        const end = Date.now() + 2000;
        while (!check()) {
          assert.ok(Date.now() < end, 'inherited writer must be ready');
          await pause(10);
        }
      };
      if (mode === 'launch-error') {
        const launch = launchBrowser({ timeoutMs: 3000 });
        await until(() => fs.existsSync(marker + '.writer'));
        fs.writeFileSync(marker + '.exit', 'exit');
        await assert.rejects(launch, error => {
          assert.match(error.message, /Chrome exited before DevTools was ready [(]7[)]/);
          assert.match(error.message, /owned stdout before main exit/);
          assert.match(error.message, /owned stderr before main exit/);
          return true;
        });
      } else {
        const main = spawn(process.execPath, [${JSON.stringify(inheritedMain)}],
          { stdio: ['ignore', 'pipe', 'pipe'] });
        let output = '';
        main.stdout.on('data', chunk => { output += chunk; });
        main.stderr.on('data', chunk => { output += chunk; });
        const pipeCloses = [main.stdout, main.stderr].map(pipe => new Promise(resolve => {
          pipe.once('close', () => {
            assert.ok(main.exitCode != null || main.signalCode != null,
              'owned pipe must remain available until main-process exit is verified');
            resolve();
          });
        }));
        const exited = new Promise(resolve => main.once('exit', (code, signal) => resolve({ code, signal })));
        await until(() => fs.existsSync(marker + '.writer') && output.includes('owned stdout') &&
          output.includes('owned stderr'));
        if (mode === 'already-exited') {
          fs.writeFileSync(marker + '.exit', 'exit');
          assert.deepEqual(await exited, { code: 0, signal: null });
        }
        await stopBrowser(main);
        assert.deepEqual(await exited, mode === 'already-exited'
          ? { code: 0, signal: null } : { code: null, signal: 'SIGTERM' });
        assert.ok(main.stdout.destroyed && main.stderr.destroyed,
          'an inherited writer must not leave the exited main process pipes owned by this runner');
        await Promise.all(pipeCloses);
        assert.match(output, /owned stdout before main exit/);
        assert.match(output, /owned stderr before main exit/);
      }
      console.log('inherited stdio cleanup completed: ' + mode);
    `], {
      env: { ...process.env, DAIKIN_BROWSER_BIN: inheritedBrowser,
        DAIKIN_BROWSER_STDIO_MODE: mode, DAIKIN_BROWSER_STDIO_MARKER: marker },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    runner.stdout.on("data", chunk => { output += chunk; });
    runner.stderr.on("data", chunk => { output += chunk; });
    try {
      const completion = await stopped(runner, 4000);
      assert.equal(completion.code, 0, `${mode}: runner must exit naturally\n${output}`);
      assert.match(output, /inherited stdio cleanup completed/);
      const recorded = JSON.parse(fs.readFileSync(marker, "utf8"));
      assert.equal(Boolean(active(recorded.pid)), false, `${mode}: main process must exit first`);
      assert.ok(active(recorded.writer), `${mode}: inherited writer must still own its open pipes`);
      if (mode === "launch-error")
        assert.equal(fs.existsSync(recorded.profile), false, "failed launch must remove its profile after exit");
      console.log(`browser cleanup selftest: ${mode} exits despite a live inherited writer`);
    } finally {
      const recorded = fs.existsSync(marker) ? JSON.parse(fs.readFileSync(marker, "utf8")) : {};
      for (const pid of [runner.pid, recorded.pid, recorded.writer].filter(Number.isInteger)) {
        if (active(pid)) process.kill(pid, "SIGKILL");
        await until(() => !active(pid), `${mode}: owned fixture PID ${pid} must be cleaned`);
      }
    }
  }

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
  fs.rmSync(work, { recursive: true, force: true });
}
