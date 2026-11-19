import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const fixture = fileURLToPath(new URL("./dev_ota_upload/fixture.py", import.meta.url));
const result = spawnSync("python3", ["-B", fixture], { encoding: "utf8", timeout: 60000 });
assert.equal(result.status, 0, `${result.error || ""}\n${result.stdout}${result.stderr}`);
console.log("Local dev OTA uploader: artifact, any-board target, channel, one-write and reboot witnesses passed");
