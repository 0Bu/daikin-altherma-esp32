import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const work = fs.mkdtempSync(path.join(os.tmpdir(), "daikin-browser-runner-selftest-"));
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const active = (pid) => {
  const result = spawnSync("ps", ["-p", String(pid), "-o", "stat="], { encoding: "utf8" });
  return result.status === 0 && result.stdout.trim() && !result.stdout.trim().startsWith("Z");
};
const fakeNode = String.raw`
const fs = require("node:fs");
const { spawn } = require("node:child_process");
const path = require("node:path");
const [script, ...args] = process.argv.slice(2);
const dir = process.env.RUNNER_FIXTURE;
if (script.endsWith("find_browser.mjs")) {
  console.log("/synthetic/browser");
} else if (script.endsWith("assemble_page.mjs")) {
  if (process.env.RUNNER_MODE === "assembler-fails") process.exit(1);
  fs.writeFileSync(args[0], "<!doctype html><title>runner fixture</title>");
} else if (script.endsWith("run_render.mjs")) {
  const supervisor = spawn(process.execPath, [script, ...args], { stdio: "inherit" });
  process.on("SIGTERM", () => supervisor.kill("SIGTERM"));
  process.on("SIGINT", () => supervisor.kill("SIGINT"));
  supervisor.once("exit", (code, signal) => process.exit(code ?? (signal === "SIGINT" ? 130 : 143)));
} else if (script.endsWith("selftest.mjs")) {
  fs.writeFileSync(path.join(dir, "selftest-reached"), "yes");
} else if (script.endsWith("test_browser_render.mjs")) {
  const viewport = args[args.indexOf("--viewport") + 1] || "combined";
  const page = process.env.DAIKIN_BROWSER_PAGE;
  const descendantSource = [
    'const fs = require("node:fs"); process.on("SIGTERM", () => {});',
    'fs.writeFileSync(' + JSON.stringify(path.join(dir, viewport + "-descendant-ready")) + ', "yes");',
    'setInterval(() => { if (!fs.existsSync(' + JSON.stringify(page) + ')) fs.writeFileSync(' +
      JSON.stringify(path.join(dir, "page-removed-while-live")) + ', "yes"); }, 10);',
  ].join("\n");
  const descendant = spawn(process.execPath, ["-e", descendantSource], { stdio: "ignore" });
  fs.writeFileSync(path.join(dir, viewport + ".json"), JSON.stringify({ pid: process.pid, descendant: descendant.pid, page }));
  const mode = process.env.RUNNER_MODE;
  const end = () => {
    if (!fs.existsSync(path.join(dir, viewport + "-descendant-ready"))) { setTimeout(end, 10); return; }
    if (mode === "success") process.exit(0);
    if (mode === "phone-fails" && viewport === "phone") process.exit(1);
    if (mode === "desktop-fails" && viewport === "desktop") process.exit(2);
    if (mode === "both-fail") process.exit(1);
  };
  setTimeout(end, 40);
  setInterval(() => {}, 1000);
} else {
  console.error("unknown fake-node fixture script", script);
  process.exit(2);
}
`;

try {
  for (const [mode, expected] of [["success", 0], ["phone-fails", 1], ["desktop-fails", 2],
    ["both-fail", 1], ["interrupt", 143], ["deadline", 2], ["invalid-deadline", 2],
    ["assembler-fails", 2], ["forged-directory", 0]]) {
    const fixture = path.join(work, mode);
    fs.mkdirSync(path.join(fixture, "scripts"), { recursive: true });
    fs.mkdirSync(path.join(fixture, "tools/browser"), { recursive: true });
    fs.mkdirSync(path.join(fixture, "bin"));
    fs.mkdirSync(path.join(fixture, "tmp"));
    fs.copyFileSync(process.env.DAIKIN_BROWSER_RUNNER_SOURCE || path.join(root, "scripts/run-browser-render-tests.sh"),
      path.join(fixture, "scripts/run-browser-render-tests.sh"));
    fs.copyFileSync(path.join(root, "tools/browser/run_render.mjs"), path.join(fixture, "tools/browser/run_render.mjs"));
    fs.writeFileSync(path.join(fixture, "bin/node"), `#!${process.execPath}\n${fakeNode}`, { mode: 0o755 });
    const sentinel = path.join(fixture, "user-work");
    fs.mkdirSync(sentinel);
    fs.writeFileSync(path.join(sentinel, "index.html"), "preserve this user-owned sentinel");
    const runner = spawn("bash", [path.join(fixture, "scripts/run-browser-render-tests.sh"),
      ...(mode === "forged-directory" ? [sentinel] : [])], {
      cwd: fixture, stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, PATH: `${path.join(fixture, "bin")}${path.delimiter}${process.env.PATH}`,
        TMPDIR: path.join(fixture, "tmp"), RUNNER_FIXTURE: fixture,
        RUNNER_MODE: mode === "forged-directory" ? "success" : mode,
        DAIKIN_BROWSER_PAGE: path.join(sentinel, "index.html"),
        DAIKIN_BROWSER_TIMEOUT_MS: mode === "invalid-deadline" ? "invalid" : mode === "deadline" ? "400" : "5000" },
    });
    let output = "";
    runner.stdout.on("data", (chunk) => { output += chunk; });
    runner.stderr.on("data", (chunk) => { output += chunk; });
    const completion = new Promise((resolve) => runner.once("exit", (code, signal) => resolve({ code, signal })));
    const watchdog = setTimeout(() => runner.kill("SIGKILL"), 8500);
    try {
      if (mode === "interrupt") {
        const end = Date.now() + 3000;
        while (!fs.existsSync(path.join(fixture, "desktop-descendant-ready")) ||
               !fs.existsSync(path.join(fixture, "phone-descendant-ready"))) {
          assert.ok(Date.now() < end, "interrupt must reach both real process trees");
          await pause(20);
        }
        runner.kill("SIGTERM");
      }
      const result = await completion;
      assert.equal(result.code, expected, `${mode}: preserve the appropriate exit status\n${output}`);
      for (const viewport of ["phone", "desktop"]) {
        const marker = path.join(fixture, `${viewport}.json`);
        if (!fs.existsSync(marker)) {
          assert.ok(["invalid-deadline", "assembler-fails"].includes(mode), `${mode}: both viewport workers must start`);
          continue;
        }
        const recorded = JSON.parse(fs.readFileSync(marker, "utf8"));
        assert.equal(Boolean(active(recorded.pid)), false, `${mode}/${viewport}: worker must be joined`);
        assert.equal(Boolean(active(recorded.descendant)), false,
          `${mode}/${viewport}: exited parent cannot orphan a TERM-resistant descendant`);
        assert.equal(fs.existsSync(recorded.page), false, `${mode}: shared page must be removed\n${output}`);
      }
      assert.equal(fs.existsSync(path.join(fixture, "page-removed-while-live")), false,
        `${mode}: shared page must stay available until all descendants end`);
      assert.deepEqual(fs.readdirSync(path.join(fixture, "tmp")), [], `${mode}: no temporary tree may remain`);
      assert.equal(fs.existsSync(path.join(fixture, "selftest-reached")), ["success", "forged-directory"].includes(mode),
        `${mode}: selftests run only after both viewport workers succeed`);
      assert.equal(fs.readFileSync(path.join(sentinel, "index.html"), "utf8"), "preserve this user-owned sentinel",
        `${mode}: CLI arguments and a forged page environment cannot transfer cleanup ownership`);
      console.log(`browser runner selftest: ${mode} status, both process trees and cleanup order observed`);
    } finally {
      clearTimeout(watchdog);
      runner.kill("SIGKILL");
      for (const viewport of ["phone", "desktop"]) {
        const marker = path.join(fixture, `${viewport}.json`);
        if (!fs.existsSync(marker)) continue;
        const recorded = JSON.parse(fs.readFileSync(marker, "utf8"));
        for (const pid of [recorded.pid, recorded.descendant]) {
          try { process.kill(pid, "SIGKILL"); } catch (error) { if (error.code !== "ESRCH") throw error; }
        }
      }
    }
  }
} finally {
  fs.rmSync(work, { recursive: true, force: true });
}
