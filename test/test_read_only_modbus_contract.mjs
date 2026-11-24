// Verify the entire component remains read-only, including generated definition sources.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const read = rel => fs.readFileSync(path.join(root, rel), "utf8");

assert.ok(!fs.existsSync(path.join(root, "main/logic/homehub_actuator.hpp")),
  "the retired actuator contract must stay deleted");

const outdoorEvidence = read("main/logic/outdoor_evidence.hpp");
assert.match(outdoorEvidence,
  /outdoor_x10a_evidence[\s\S]*rps_known\s*&&\s*rps_running/,
  "X10A page 0x20 must require a positive running witness, not held=false alone");
assert.match(outdoorEvidence, /outdoor_homehub_evidence[\s\S]*current_session/,
  "HomeHub input 44 must be bound to the TCP session which answered this cycle");
const modbusPoll = read("main/hp_modbus.cpp");
assert.match(modbusPoll,
  /r\.offset == 44[\s\S]*homehub_decode[\s\S]*outdoor_homehub_evidence/,
  "input 44 must be decoded from the current poll and sealed after session validation");

// Walk the COMPLETE main tree recursively. The former non-recursive scan skipped main/def entirely,
// so its claim about "every firmware source" covered only 119 of 169 C++ files.
function collect(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const absolute = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...collect(absolute));
    else if (/\.(cpp|hpp)$/.test(entry.name)) out.push(path.relative(root, absolute));
  }
  return out;
}
const sources = collect(path.join(root, "main"));
const forbidden = [
  [/mb_request_lwt_offset\s*\(/, "retired LWT write entry point"],
  [/mb_set_actuation_writer_ownership\s*\(/, "retired writer-ownership API"],
  [/mb_request_actuation_restore\s*\(/, "retired restore request"],
  [/\bLwtOffsetIntent\b|\bHomeHubActuator\b|\bActuatorPlan\b/, "actuator contract type"],
  [/mb_build_write_(?:single|multiple)\s*\(/, "Modbus write-request builder"],
  [/MbFunc::Write(?:Single|Multiple)/, "Modbus write function code"],
];
for (const rel of sources) {
  const body = read(rel);
  for (const [pattern, what] of forbidden)
    assert.doesNotMatch(body, pattern, `${rel} must not contain ${what}`);
}

const modbus = read("main/logic/modbus.hpp");
assert.doesNotMatch(modbus,
  /WriteSingle|WriteMultiple|EchoMismatch|echo_addr|echo_value|mb_encode|MB_MAX_WRITE_REGS/,
  "read-only protocol core must not retain write framing, echo parsing or value encoders");

const store = read("main/logic/config_store.hpp");
assert.match(store, /v14 block[\s\S]*v\.push_back\(0\);/,
  "retired v14 mode byte must retain its layout position and serialize as zero");

console.log(`Modbus is read-only: no write capability in ${sources.length} sources`);
