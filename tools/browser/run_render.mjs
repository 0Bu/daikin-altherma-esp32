import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const args = process.argv.slice(2);
const timeout = process.env.DAIKIN_BROWSER_TIMEOUT_MS || "600000";
if (!/^[1-9][0-9]*$/.test(timeout) || Number(timeout) > 3600000) {
  console.error("browser render gate: invalid DAIKIN_BROWSER_TIMEOUT_MS (1..3600000)");
  process.exitCode = 2;
} else {
  let work;
  try { work = fs.mkdtempSync(path.join(os.tmpdir(), "daikin-browser-render.")); }
  catch (error) { console.error(`browser render gate setup: ${error.message}`); process.exit(2); }
  process.env.DAIKIN_BROWSER_PAGE = path.join(work, "index.html");
  const jobs = [];
  let cancel, cancellation;
  const cancelled = new Promise((resolve) => {
    cancel = (value) => { cancellation ||= value; resolve(cancellation); };
  });
  const interrupt = (signal) => cancel({ status: signal === "SIGINT" ? 130 : 143, reason: signal });
  const onInt = () => interrupt("SIGINT");
  const onTerm = () => interrupt("SIGTERM");
  process.on("SIGINT", onInt);
  process.on("SIGTERM", onTerm);
  const timer = setTimeout(() => cancel({ status: 2, reason: "overall deadline exceeded" }), Number(timeout));

  function start(script, extra = []) {
    // Each worker owns a distinct POSIX process group. Its ordinary Chrome subprocesses and
    // their descendants remain in that group, so a terminated Node cannot orphan the browser.
    const child = spawn("node", [script, ...extra], { stdio: "inherit", detached: true });
    const job = { child, done: false, status: null, retired: false };
    job.result = new Promise((resolve) => {
      const finish = (status) => {
        if (job.done) return;
        job.done = true;
        job.status = status;
        resolve({ job, status });
      };
      child.once("error", (error) => {
        console.error(`browser render gate: could not start ${script}: ${error.message}`);
        finish(2);
      });
      child.once("exit", (code, signal) => finish(code ?? (signal === "SIGINT" ? 130 : 143)));
    });
    jobs.push(job);
    return job;
  }

  function signalGroup(job, signal) {
    if (job.retired || !job.child.pid) return;
    try { process.kill(-job.child.pid, signal); }
    catch (error) {
      if (error.code === "ESRCH") return;
      // macOS can report EPERM for an already-ended orphan group during reaping.
      // Only forgive that after a metadata-only probe proves no live member remains.
      if (error.code === "EPERM" && !groupActive(job)) return;
      throw error;
    }
  }

  function groupActive(job) {
    if (job.retired) return false;
    if (!job.child.pid) return !job.done;
    try { process.kill(-job.child.pid, 0); }
    catch (error) {
      if (error.code === "ESRCH") {
        if (job.done) job.retired = true;
        return false;
      }
      if (error.code !== "EPERM") throw error;
    }
    // Orphaned zombies have ended and cannot read the shared page. Some Linux init processes
    // reap them slowly. Inspect only process-group IDs and state, never argv or environment.
    const states = spawnSync("ps", ["-axo", "pgid=,stat="], { encoding: "utf8", timeout: 1000 });
    if (states.error || states.status !== 0) return true;
    const members = states.stdout.split("\n").map((line) => line.trim().split(/\s+/))
      .filter(([group]) => group === String(job.child.pid));
    const active = members.some(([, state]) => !state?.startsWith("Z"));
    if (!active && job.done) job.retired = true;
    return active;
  }

  async function settled(deadline) {
    while (jobs.some((job) => !job.done || groupActive(job))) {
      if (Date.now() >= deadline) return false;
      await pause(25);
    }
    return true;
  }

  async function stopAll() {
    // Retire joined groups as soon as they are gone; never signal a historical PGID again.
    for (const job of jobs) if (job.done) groupActive(job);
    for (const job of jobs) signalGroup(job, "SIGTERM");
    if (await settled(Date.now() + 1500)) return;
    // A leader may already have exited on TERM while a Chrome descendant ignores it.
    // Always address the original group, including groups whose direct child was joined.
    for (const job of jobs) signalGroup(job, "SIGKILL");
    if (!await settled(Date.now() + 1500)) throw new Error("owned browser processes did not end after SIGKILL");
    await Promise.all(jobs.map((job) => job.result));
  }

  async function complete(batch) {
    const waiting = new Set(batch);
    while (waiting.size) {
      const result = await Promise.race([cancelled, ...[...waiting].map((job) => job.result)]);
      if (result.reason) {
        console.error(`browser render gate: ${result.reason}`);
        return result.status;
      }
      waiting.delete(result.job);
      groupActive(result.job);
      if (result.status !== 0) return result.status;
    }
    return cancellation?.status ?? 0;
  }

  let status = 2;
  try {
    status = await complete([start("tools/browser/assemble_page.mjs", [process.env.DAIKIN_BROWSER_PAGE])]);
    if (status !== 0 && !cancellation) status = 2; // Assembly failed before rendering could begin.
    await stopAll();
    if (status === 0) {
      const batch = process.env.DAIKIN_BROWSER_PARALLEL !== "0"
        ? [start("test/test_browser_render.mjs", ["--viewport", "phone", ...args]),
           start("test/test_browser_render.mjs", ["--viewport", "desktop", ...args])]
        : [start("test/test_browser_render.mjs", args)];
      status = cancellation?.status ?? await complete(batch);
      if (status === 0) {
        await stopAll();
        status = cancellation?.status ?? await complete([start("tools/browser/selftest.mjs")]);
      }
    }
  } catch (error) {
    console.error(`browser render gate: ${error.message}`);
    status = 2;
  } finally {
    clearTimeout(timer);
    try {
      await stopAll();
      fs.rmSync(work, { recursive: true, force: true });
    } catch (error) {
      console.error(`browser render gate cleanup: ${error.message}; retained ${work}`);
      status = 2;
    }
    process.off("SIGINT", onInt);
    process.off("SIGTERM", onTerm);
  }
  if (status === 0) console.log("complete browser rendering and accessibility gate passed");
  process.exitCode = status;
}
