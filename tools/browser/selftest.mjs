import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
assert.ok(process.env.DAIKIN_BROWSER_PAGE, "browser selftest requires DAIKIN_BROWSER_PAGE from the runner");
assert.ok(process.env.DAIKIN_BROWSER_BIN, "browser selftest requires DAIKIN_BROWSER_BIN from the runner");

const result = spawnSync(process.execPath, [path.join(root, "test/test_browser_render.mjs")], {
  cwd: root,
  encoding: "utf8",
  env: { ...process.env, DAIKIN_BROWSER_MUTATION: "root-overflow" },
});
const output = `${result.stdout || ""}\n${result.stderr || ""}`;
assert.notEqual(result.status, 0, "layout mutation must make the browser gate fail");
assert.match(output, /selftest\/root-overflow: horizontal viewport overflow/,
  "selftest must fail for the deliberately introduced root overflow, not for an unrelated reason");
console.log("browser render selftest passed: injected root overflow was rejected");
