import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const work = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "daikin-browser-container-selftest-")));
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const docker = String.raw`
const fs = require('node:fs');
const args = process.argv.slice(2);
fs.appendFileSync(process.env.FIXTURE_LOG, JSON.stringify(args)+'\n');
if(args[0]==='build') {
  if(process.env.FIXTURE_MODE==='build-fails') process.exit(2);
  if(process.env.FIXTURE_MODE==='build-interrupt') {
    fs.writeFileSync(process.env.FIXTURE_READY, String(process.pid));
    process.on('SIGTERM',()=>{});
    setInterval(()=>{},1000);
  } else console.log(process.env.FIXTURE_MODE==='bad-image'?'unexpected output':'sha256:'+'a'.repeat(64));
} else if(args[0]==='run') {
  if(process.env.FIXTURE_MODE==='runtime-fails') process.exit(125);
  fs.writeFileSync(args[args.indexOf('--cidfile')+1], 'b'.repeat(64));
  fs.writeFileSync(process.env.FIXTURE_READY, String(process.pid));
  if(process.env.FIXTURE_MODE==='interrupt') setInterval(()=>{},1000);
  else process.exit(process.env.FIXTURE_MODE==='gate-fails'?1:0);
} else if(args[0]==='rm') {
  if(process.env.FIXTURE_MODE==='rm-hangs') {
    fs.writeFileSync(process.env.FIXTURE_CLEANUP_PID,String(process.pid));
    process.on('SIGTERM',()=>{});setInterval(()=>{},1000);
  } else if(['rm-fails','daemon-fails','already-removed','ps-hangs'].includes(process.env.FIXTURE_MODE)) process.exit(1);
} else if(args[0]==='ps') {
  if(process.env.FIXTURE_MODE==='daemon-fails') process.exit(2);
  if(process.env.FIXTURE_MODE==='ps-hangs') {
    fs.writeFileSync(process.env.FIXTURE_CLEANUP_PID,String(process.pid));
    process.on('SIGTERM',()=>{});setInterval(()=>{},1000);
  } else if(['rm-fails','rm-hangs'].includes(process.env.FIXTURE_MODE)) console.log('b'.repeat(64));
} else process.exit(2);
`;
try {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, "tools/browser/package.json"), "utf8"));
  const lock = JSON.parse(fs.readFileSync(path.join(root, "tools/browser/package-lock.json"), "utf8"));
  const dockerfile = fs.readFileSync(path.join(root, "tools/browser/Dockerfile"), "utf8");
  const pin = dockerfile.match(/^FROM mcr\.microsoft\.com\/playwright:v([\d.]+)-noble@sha256:([a-f0-9]{64})$/m);
  assert.ok(pin, "browser image must pin the official version and immutable digest");
  assert.equal(pin[1], manifest.dependencies.playwright, "browser image and API package must match");
  assert.equal(lock.packages["node_modules/playwright"].version, pin[1]);
  assert.equal(lock.packages["node_modules/playwright-core"].version, pin[1]);
  assert.match(lock.packages["node_modules/playwright"].integrity, /^sha512-/);
  const selection = fs.readFileSync(path.join(root, "tools/browser/find_browser.mjs"), "utf8");
  assert.ok(!selection.includes("/Applications/"), "automatic discovery must never select a native macOS app");
  const { findBrowser } = await import("./find_browser.mjs");
  assert.equal(findBrowser(process.execPath, "darwin"), null,
    "macOS discovery must refuse even an explicit executable before any spawn");
  if (process.platform === "darwin")
    assert.equal(findBrowser(process.execPath), null, "even an explicit executable cannot start native macOS browser tests");

  for (const [mode, expected] of [["success", 0], ["gate-fails", 1], ["build-fails", 2],
    ["bad-image", 2], ["runtime-fails", 2], ["interrupt", 143],
    ["rm-fails", 2], ["daemon-fails", 2], ["already-removed", 0], ["build-interrupt", 143],
    ["rm-hangs", 2], ["ps-hangs", 2]]) {
    const fixture = path.join(work, mode + " with spaces");
    fs.mkdirSync(path.join(fixture, "scripts"), { recursive: true });
    fs.mkdirSync(path.join(fixture, "tools/browser"), { recursive: true });
    fs.mkdirSync(path.join(fixture, "bin"));
    const scratch = path.join(work, mode + "-scratch");
    fs.mkdirSync(scratch);
    fs.mkdirSync(path.join(fixture, "main/www"), { recursive: true });
    fs.writeFileSync(path.join(fixture, "main/www/index.html"), "<title>synthetic source</title>");
    fs.copyFileSync(path.join(root, "tools/browser/stage_source.py"), path.join(fixture, "tools/browser/stage_source.py"));
    fs.copyFileSync(path.join(root, "tools/browser/docker_cleanup.py"), path.join(fixture, "tools/browser/docker_cleanup.py"));
    for (const script of ["run-browser-render-tests.sh", "run-browser-tests-linux.sh"])
      fs.copyFileSync(path.join(root, "scripts", script), path.join(fixture, "scripts", script));
    fs.writeFileSync(path.join(fixture, "bin/docker"), `#!${process.execPath}\n${docker}`, { mode: 0o755 });
    const log = path.join(fixture, "calls.jsonl"), ready = path.join(fixture, "ready");
    const cleanupPid = path.join(fixture, "cleanup-pid");
    const native = path.join(fixture, "bin/google-chrome");
    fs.writeFileSync(native, `#!${process.execPath}\nrequire('node:fs').writeFileSync(${JSON.stringify(path.join(fixture, "native-started"))},'bad');`, { mode: 0o755 });
    assert.equal(spawnSync("git", ["init", "-q", fixture]).status, 0, "synthetic source must have local Git inventory");
    const child = spawn("bash", [path.join(fixture, "scripts/run-browser-render-tests.sh"),
      "--history-motion-case", "board"], { env: { ...process.env,
      PATH: path.join(fixture, "bin") + path.delimiter + process.env.PATH,
      TMPDIR: scratch, DAIKIN_BROWSER_CONTAINER: "0",
      DAIKIN_BROWSER_BIN: native, FIXTURE_LOG: log, FIXTURE_READY: ready, FIXTURE_MODE: mode,
      FIXTURE_CLEANUP_PID: cleanupPid },
      stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    child.stdout.on("data", chunk => { output += chunk; });
    child.stderr.on("data", chunk => { output += chunk; });
    const completed = new Promise(resolve => child.once("exit", (code, signal) => resolve({ code, signal })));
    const watchdog = setTimeout(() => child.kill("SIGKILL"), 15000);
    try {
      if (["interrupt", "build-interrupt"].includes(mode)) {
        const end = Date.now() + 5000;
        while (!fs.existsSync(ready)) { assert.ok(Date.now() < end, output); await wait(20); }
        child.kill("SIGTERM");
      }
      const result = await completed;
      assert.equal(result.code, expected, mode + ": preserve status and interruption\n" + output);
      assert.equal(fs.existsSync(path.join(fixture, "native-started")), false,
        mode + ": never launch installed Chrome even when explicitly selected");
      const calls = fs.readFileSync(log, "utf8").trim().split("\n").map(line => JSON.parse(line));
      const run = calls.find(args => args[0] === "run");
      if (["build-fails", "bad-image", "build-interrupt"].includes(mode)) assert.equal(run, undefined);
      else {
        assert.ok(run.includes("--read-only") && run.includes("--init") && run.includes("--rm"));
        assert.equal(run[run.indexOf("--network") + 1], "none");
        assert.equal(run[run.indexOf("--cap-drop") + 1], "ALL");
        assert.equal(run[run.indexOf("--security-opt") + 1], "no-new-privileges");
        assert.match(run[run.indexOf("--tmpfs") + 1], /\/tmp:rw,exec,nosuid,nodev,/,
          "temporary native fixture executables must run inside the isolated container");
        const snapshot = path.join(path.dirname(run[run.indexOf("--cidfile") + 1]), "source");
        const build = calls.find(args => args[0] === "build");
        assert.equal(build.at(-1), snapshot, "build only the staged source, never the worktree");
        assert.equal(build[build.indexOf("--file") + 1], path.join(snapshot, "tools/browser/Dockerfile"));
        assert.ok(!run.includes("--mount") && !run.includes("-v"), "no host paths or profiles may be mounted at runtime");
        assert.ok(!run.some(value => value.includes("DAIKIN_BROWSER_BIN")));
        assert.deepEqual(run.slice(-4), ["bash", "scripts/run-browser-render-tests.sh", "--history-motion-case", "board"]);
        if (mode !== "runtime-fails")
          assert.ok(calls.some(args => args[0] === "rm" && args[2] === "b".repeat(64)),
            mode + ": cleanup must address only this invocation's container ID");
      }
      if (["rm-fails", "daemon-fails", "rm-hangs", "ps-hangs"].includes(mode)) {
        assert.match(output, /container removal unverified; retained ownership record/);
        const retained = fs.readdirSync(scratch);
        assert.equal(retained.length, 1, mode + ": retain container ownership and source after failed cleanup");
        assert.equal(fs.readFileSync(path.join(scratch, retained[0], "cid"), "utf8"), "b".repeat(64));
        assert.ok(fs.existsSync(path.join(scratch, retained[0], "source/main/www/index.html")));
      } else assert.deepEqual(fs.readdirSync(scratch), [], mode + ": owned temporary directory must be removed");
      if (mode === "build-interrupt") {
        const pid = Number(fs.readFileSync(ready, "utf8"));
        assert.throws(() => process.kill(pid, 0), error => error.code === "ESRCH",
          "interrupted build client must be joined, including a TERM-resistant child");
      }
      if (["rm-hangs", "ps-hangs"].includes(mode)) {
        const pid = Number(fs.readFileSync(cleanupPid, "utf8"));
        assert.throws(() => process.kill(pid, 0), error => error.code === "ESRCH",
          "timed-out cleanup client must be terminated and joined");
      }
      console.log("browser container selftest passed: " + mode + "; native app untouched");
    } finally { clearTimeout(watchdog); child.kill("SIGKILL"); }
  }
} finally { fs.rmSync(work, { recursive: true, force: true }); }
