// Focused renderers provide S themselves. The lifecycle reader must load only the actual shared
// functions and reject ambiguous section boundaries instead of silently running a partial fixture.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";
import { readHistoryLifecycle } from "../tools/ui/read_app_source.mjs";

const lifecycle = readHistoryLifecycle();
const S = {
  status: { boot_id: "first-boot", history: { epoch: 1 } },
  hist: new Map([["old", {}]]), histBusy: new Set(["old"]), histPin: new Map([["old", {}]]),
};
const context = vm.createContext({ S });
vm.runInContext(`${lifecycle}\nthis.sync = syncHistSources;`, context);
assert.equal(context.sync(), 0, "the actual lifecycle establishes a baseline without losing rings");
S.status.history.epoch++;
assert.equal(context.sync(), 1, "the extracted production lifecycle retires a changed device ring epoch");
assert.equal(S.hist.size, 0);
assert.equal(S.histBusy.size, 0);
assert.equal(S.histPin.size, 0);

const directory = fs.mkdtempSync(path.join(os.tmpdir(), "daikin-ui-lifecycle-"));
try {
  const manifest = path.join(directory, "app.sources");
  const state = path.join(directory, "app_state.js");
  fs.writeFileSync(manifest, "app_state.js\n");
  const start = "// ── History source lifecycle";
  const end = "// ── Navigation (dashboard ⇄ Settings)";
  const body = "function fromProductionSection() { return 17; }\n";
  fs.writeFileSync(state, `const S = {};\n${start}\n${body}${end}\nthrow new Error('navigation ran');\n`);
  const focused = vm.createContext({ S: {} });
  vm.runInContext(`${readHistoryLifecycle(manifest)}\nthis.value = fromProductionSection();`, focused);
  assert.equal(focused.value, 17, "the reader must omit the fixture-conflicting state and navigation");

  for (const malformed of [
    `${body}${end}\n`,
    `${start}\n${body}`,
    `${start}\n${start}\n${body}${end}\n`,
    `${start}\n${body}${end}\n${end}\n`,
    `${end}\n${body}${start}\n`,
  ]) {
    fs.writeFileSync(state, malformed);
    assert.throws(() => readHistoryLifecycle(manifest), /section boundaries/,
      "missing, duplicated and reversed section boundaries must fail closed");
  }
} finally {
  fs.rmSync(directory, { recursive: true, force: true });
}

console.log("history lifecycle reader: production functions and fail-closed section boundaries verified");
