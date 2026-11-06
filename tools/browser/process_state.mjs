import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

// A failed observation is not proof of exit. Zombies still have a PID and have not been reaped.
export function inspectProcess(pid, { observe = spawnSync } = {}) {
  assert.ok(Number.isInteger(pid) && pid > 1, "process inspection requires an owned child PID");
  const result = observe("ps", ["-p", String(pid), "-o", "ppid=,stat="], { encoding: "utf8" });
  assert.ok(!result.error && !result.signal, "process inspection must complete normally");
  assert.equal(result.stderr, "", "process inspection must not report an error");
  if (result.status === 1 && !result.stdout.trim()) return { present: false };
  assert.equal(result.status, 0, "process inspection must return a process or explicit empty absence");
  const fields = result.stdout.trim().split(/\s+/), [parent, state] = fields;
  assert.ok(/^[1-9][0-9]*$/.test(parent) && state && fields.length === 2,
    "process inspection must return one valid parent/state row");
  return { present: true, parent: Number(parent), state };
}
