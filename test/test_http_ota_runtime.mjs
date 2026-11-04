import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "daikin-http-ota-"));
try {
  const binary = path.join(temp, "fixture");
  const result = spawnSync(process.env.CXX || "c++", ["-std=c++20", "-Wall", "-Wextra", "-Werror",
    `-I${root}/test/http_stream_runtime/stubs`, `-I${root}/main`,
    `-DHTTP_OTA_SOURCE=${JSON.stringify(path.join(root,"main/http_ota.cpp"))}`,
    path.join(root,"test/http_ota_runtime/fixture.cpp"), "-o",binary], {encoding:"utf8",timeout:60000});
  assert.equal(result.status,0,result.stdout + result.stderr);
  const run = spawnSync(binary,[],{encoding:"utf8",timeout:10000});
  assert.equal(run.status,0,run.stdout + run.stderr);
  console.log(run.stdout.trim());
} finally {
  fs.rmSync(temp,{recursive:true,force:true});
}
