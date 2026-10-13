// The PR filter must include every source file copied by either OTA mutation suite.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const workflow = fs.readFileSync(path.join(root, ".github/workflows/build.yml"), "utf8");
const scope = workflow.match(/^\s*emit ota '([^']+)'\s*$/m);
assert.ok(scope, "missing literal OTA mutation-scope filter");
const inputs = new Set(["test/test_ota_mutation_scope_contract.mjs"]);
for (const suite of ["tools/ota/selftest.mjs", "tools/production_ota/selftest.mjs"]) {
  inputs.add(suite);
  const source = fs.readFileSync(path.join(root, suite), "utf8");
  const inventory = source.match(/const files\s*=\s*(\[[\s\S]*?\]);/);
  assert.ok(inventory, `missing literal mutation input inventory: ${suite}`);
  const files = JSON.parse(inventory[1].replace(/,\s*\]/, "]"));
  assert.ok(Array.isArray(files) && files.length > 10 && files.every(file => typeof file === "string"));
  for (const file of files) inputs.add(file);
}
const selected = (pattern, file) => {
  const result = spawnSync("grep", ["-Eq", pattern], { input: file + "\n", encoding: "utf8" });
  assert.ok(result.status === 0 || result.status === 1, `invalid OTA scope filter: ${result.stderr}`);
  return result.status === 0;
};
const missing = pattern => [...inputs].filter(file => !selected(pattern, file));
assert.deepEqual(missing(scope[1]), [], "PR OTA mutation filter omits copied production inputs");
for (const unrelated of ["README.md", "docs/README.md", "docs/media/dashboard.gif", "main/www/fixture.html"]) {
  assert.equal(selected(scope[1], unrelated), false, `unrelated path unexpectedly runs OTA mutations: ${unrelated}`);
}
// The exact former hole must still be observable if the broad production-source arm is removed.
const narrow = scope[1].replace(/\|main\/\(CMakeLists[\s\S]*?\|sdkconfig/, "|main/logic/ota_.*|sdkconfig");
assert.notEqual(narrow, scope[1], "missing production-source scope arm");
assert.ok(missing(narrow).includes("main/mqtt_ha.cpp"), "scope countercontrol must reject the former MQTT omission");
console.log(`OTA mutation scope: ${inputs.size} actual input paths covered; MQTT omission countercontrol passed`);
