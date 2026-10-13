import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const result = spawnSync("python3", [path.join(testDirectory, "detect_runtime/run.py"), ...process.argv.slice(2)], {
  cwd: path.dirname(testDirectory), encoding: "utf8", timeout: 180000, maxBuffer: 4 * 1024 * 1024,
});
assert.ifError(result.error);
process.stdout.write(result.stdout);
process.stderr.write(result.stderr);
assert.equal(result.status, 0, "complete production detection runtime and negative controls must pass");
