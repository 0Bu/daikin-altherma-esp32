import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
for (const [mutation, assertion, extra] of [
  ["history-eager", /polls must not rebuild cached charts in closed rows/],
  ["history-stall", /history frame responsiveness budget exceeded/],
  ["history-replace", /unchanged plot must remain mounted/],
  ["history-restart", /preserve running CSSAnimation instance/],
  ["history-unknown", /history inspector inventory must classify every production entry/],
  ["history-disclosure-replace", /unchanged plot must remain mounted/, ["--history-motion-case", "board"]],
  ["history-detach", /unchanged history ancestors must remain connected/, ["--history-motion-case", "board"]],
  ["history-text-stale", /changed board telemetry must update the visible reading/, ["--history-motion-case", "board"]],
  ["history-paint-freeze", /WebKit painted flow must change across native screenshots/],
]) {
  const result = spawnSync(process.execPath, [path.join(root, "test/test_browser_webkit.mjs"),
    "--viewport", "ipad-portrait", ...(extra || [])], {
    cwd: root, encoding: "utf8", timeout: 90000,
    env: { ...process.env, DAIKIN_BROWSER_MUTATION: mutation },
  });
  const output = (result.stdout || "") + "\n" + (result.stderr || "");
  assert.equal(result.error, undefined, mutation + ": canary must terminate normally, not time out");
  assert.equal(result.status, 1, mutation + ": seeded defect must fail its assertion, not browser setup\n" + output);
  assert.match(output, assertion, mutation + ": must reject its own defect\n" + output);
  console.log("WebKit history selftest passed: " + mutation + " rejected by its intended assertion");
}
