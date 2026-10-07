import assert from "node:assert/strict";
import fs from "node:fs";

const read = (file) => fs.readFileSync(new URL("../" + file, import.meta.url), "utf8");
const history = read("main/history.cpp");
const functionBody = (name, next) => history.slice(history.indexOf(name), history.indexOf(next,
  history.indexOf(name) + name.length));
for (const [name, next] of [
  ["void history_reset()", "void history_reset_on_detect"],
  ["void history_reset_on_detect", "void history_modbus_reset"],
  ["void history_modbus_reset", "uint32_t history_modbus_generation"],
  ["void history_circulation_reset", "void history_checkup_reset"],
]) {
  const body = functionBody(name, next);
  assert.match(body, /Lock lk\(s_mtx\)/, name + " reset must share the sample lock");
  assert.ok(body.indexOf("Lock lk(s_mtx)") < body.indexOf("bump_history_epoch()"),
    name + " changes the browser epoch inside the sample lock");
}
for (const name of ["size_t history_snapshot(", "size_t history_modbus_snapshot(",
  "size_t history_env3_snapshot("]) {
  const body = functionBody(name, "\nsize_t ");
  assert.ok(body.includes("uint32_t* epoch"));
  const lock = body.indexOf("Lock lk(s_mtx)");
  const capture = body.indexOf("*epoch = history_epoch()", lock);
  assert.ok(lock >= 0 && capture > lock && capture < body.indexOf(".snapshot(out, max)"),
    name + " captures the epoch before copying samples under the same lock");
}
const http = read("main/http_status.cpp");
assert.match(http, /&history_snapshot_epoch/);
assert.match(http, /std::to_string\(history_snapshot_epoch\)/);
assert.match(http, /history_snapshot_epoch != history_epoch\(\)/,
  "a reset during label/raster assembly must refuse the response before chunks");
assert.match(http, /reference_temperature_status\(c\)/,
  "status must bind the room sample to the same configuration snapshot");
assert.match(http, /circulation_source_status\(c\)/);
assert.equal((history.match(/circulation_generation = circulation_source_generation\(\)/g) || []).length, 2);
assert.match(history, /circulation_generation != circulation_source_generation\(\)\) return/);
assert.equal((history.match(/circulation_generation == circulation_source_generation\(\)/g) || []).length, 2,
  "mixed recording retains independent X10A rows but skips a retired circulation witness");
const checkup = read("main/checkup.cpp");
assert.match(checkup, /dhw_generation != s_dhw_identity_generation\.load\(\)/);
assert.match(checkup, /circulation_generation != circulation_source_generation\(\)/);
assert.match(checkup, /circulation_pump_sample\(\)/);
// Per-cycle poll/MQTT paths bind the witness by its applied epoch alone; a Config copy here would be
// permanent heap churn on every sweep.
assert.doesNotMatch(checkup, /config\(\)/, "checkup_record must not copy Config per cycle");
for (const [name, next] of [
  ["void history_record_circulation()", "\nvoid "],
  ["void history_record(const CachedValue*", "\nvoid "],
]) {
  assert.doesNotMatch(functionBody(name, next), /config\(\)/,
    name + " must not copy Config per cycle");
}
console.log("history snapshot epoch and epoch-bound circulation admission contracts pass");
