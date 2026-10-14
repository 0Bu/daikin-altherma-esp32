// Focused production-TU runner; keep evidence in its unique temporary output directory.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const runner = fileURLToPath(new URL("./http_config_runtime/run.py", import.meta.url));
const result = spawnSync(process.env.PYTHON || "python3", [runner, ...process.argv.slice(2)], {
  encoding: "utf8", timeout: 180000, maxBuffer: 4 * 1024 * 1024,
});
assert.ifError(result.error);
assert.equal(result.signal, null, `configuration runtime terminated\n${result.stdout}${result.stderr}`);
assert.equal(result.status, 0, `configuration runtime failed\n${result.stdout}${result.stderr}`);
process.stdout.write(result.stdout);
