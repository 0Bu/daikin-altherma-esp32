import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { EventEmitter } from "node:events";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { removeBrowserProfile, stopBrowser } from "./cdp_browser.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
assert.ok(process.env.DAIKIN_BROWSER_PAGE, "browser selftest requires DAIKIN_BROWSER_PAGE from the runner");
assert.ok(process.env.DAIKIN_BROWSER_BIN, "browser selftest requires DAIKIN_BROWSER_BIN from the runner");

let removeAttempts = 0;
const retryPauses = [];
await removeBrowserProfile("/tmp/browser-profile-selftest", {
  remove() {
    removeAttempts++;
    if (removeAttempts < 3) {
      const error = new Error("profile is still busy");
      error.code = "ENOTEMPTY";
      throw error;
    }
  },
  pause: async (ms) => retryPauses.push(ms),
  maxRetries: 4,
  retryDelayMs: 7,
});
assert.equal(removeAttempts, 3, "profile cleanup must retry a transient ENOTEMPTY failure");
assert.deepEqual(retryPauses, [7, 7], "profile cleanup retries must stay bounded and delayed");

class DelayedExitChild extends EventEmitter {
  exitCode = null;
  signalCode = null;
  signals = [];

  kill(signal) {
    this.signals.push(signal);
    if (signal === "SIGKILL") {
      setTimeout(() => {
        this.signalCode = signal;
        this.emit("exit", null, signal);
      }, 5);
    }
    return true;
  }
}

const delayedChild = new DelayedExitChild();
await stopBrowser(delayedChild, { termTimeoutMs: 1, killTimeoutMs: 100 });
assert.deepEqual(delayedChild.signals, ["SIGTERM", "SIGKILL"],
  "browser cleanup must escalate only after the graceful-exit deadline");
assert.equal(delayedChild.signalCode, "SIGKILL",
  "browser cleanup must wait for the delayed SIGKILL exit before removing the profile");

const result = spawnSync(process.execPath, [path.join(root, "test/test_browser_render.mjs")], {
  cwd: root,
  encoding: "utf8",
  env: { ...process.env, DAIKIN_BROWSER_MUTATION: "root-overflow" },
});
const output = `${result.stdout || ""}\n${result.stderr || ""}`;
assert.notEqual(result.status, 0, "layout mutation must make the browser gate fail");
assert.match(output, /selftest\/root-overflow: horizontal viewport overflow/,
  "selftest must fail for the deliberately introduced root overflow, not for an unrelated reason");

const delayedFocus = spawnSync(process.execPath, [path.join(root, "test/test_browser_render.mjs")], {
  cwd: root,
  encoding: "utf8",
  env: { ...process.env, DAIKIN_BROWSER_MUTATION: "modal-focus-delay" },
});
const delayedFocusOutput = `${delayedFocus.stdout || ""}\n${delayedFocus.stderr || ""}`;
assert.equal(delayedFocus.status, 0,
  `modal-focus delay selftest must pass after awaiting the complete open state\n${delayedFocusOutput}`);
assert.match(delayedFocusOutput, /browser modal-focus selftest passed/,
  "modal-focus delay selftest must execute the delayed dialog-focus path");
console.log("browser render selftest passed: injected overflow was rejected and delayed modal focus awaited");
