// Compile freshly extracted production HTTP/MCP and MQTT consumer bodies with real shared headers.
// Only the source snapshot/schedule adapter lives in the fixture; this is not a firmware/socket test.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fixture = path.join(root, "test/modbus_metadata/fixture.cpp");
const httpPath = path.join(root, "main/http_status.cpp");
const mqttPath = path.join(root, "main/mqtt_ha.cpp");
const httpSource = fs.readFileSync(httpPath, "utf8");
const mqttSource = fs.readFileSync(mqttPath, "utf8");
const productionInputs = new Map([
  httpPath, mqttPath,
  ...["hp_poll.hpp", "def/homehub.hpp", "def/altherma4.hpp", "logic/modbus_catalog.hpp",
    "logic/homehub_map.hpp", "logic/mqtt_group.hpp", "logic/json.hpp", "logic/discovery.hpp",
    "logic/ha_device.hpp", "logic/modbus.hpp", "logic/config_model.hpp"]
    .map((name) => path.join(root, "main", name)),
].map((file) => [file, fs.readFileSync(file, "utf8")]));
assert.equal(productionInputs.get(httpPath), httpSource);
assert.equal(productionInputs.get(mqttPath), mqttSource);

// Balance C++ braces while skipping quoted literals and comments. Fail closed on ambiguous anchors
// or unsupported raw literals rather than silently compiling a truncated/neighboring function.
function extract(source, anchor) {
  const start = source.indexOf(anchor);
  assert(start >= 0 && source.indexOf(anchor, start + 1) < 0, `unique extraction anchor: ${anchor}`);
  const opening = source.indexOf("{", start + anchor.length);
  assert(opening >= 0, `function body: ${anchor}`);
  let depth = 0;
  for (let i = opening; i < source.length; i++) {
    const c = source[i];
    if (c === "/" && source[i + 1] === "/") {
      const newline = source.indexOf("\n", i + 2);
      assert(newline >= 0, "unterminated line comment while extracting function");
      i = newline;
    } else if (c === "/" && source[i + 1] === "*") {
      const end = source.indexOf("*/", i + 2);
      assert(end >= 0, "unterminated block comment while extracting function");
      i = end + 1;
    } else if (c === '"' || c === "'") {
      assert(!(c === '"' && source[i - 1] === "R"), "raw C++ literals require an extraction update");
      const quote = c;
      let closed = false;
      for (++i; i < source.length; i++) {
        if (source[i] === "\\") i++;
        else if (source[i] === quote) { closed = true; break; }
      }
      assert(closed, "unterminated C++ literal while extracting function");
    } else if (c === "{") depth++;
    else if (c === "}" && --depth === 0) return source.slice(start, i + 1);
  }
  assert.fail(`unbalanced function: ${anchor}`);
}

const uintBody = extract(httpSource, "template <typename JsonOut>\nstatic void append_json_uint(");
const httpBody = extract(httpSource, "template <typename JsonOut>\nstatic void append_modbus_values_array(");
const mqttBody = extract(mqttSource, "static std::vector<GroupedValue> current_modbus_values(");

function execute(command, args) {
  const result = spawnSync(command, args, {
    cwd: root, encoding: "utf8", timeout: 30000, maxBuffer: 1024 * 1024,
  });
  assert.ifError(result.error);
  assert.equal(result.signal, null, `${command} terminated: ${result.stderr}`);
  assert.equal(result.status, 0, `${command} failed: ${result.stdout}\n${result.stderr}`);
  return result.stdout;
}

function compile(name, http = httpBody, mqtt = mqttBody) {
  const httpHeader = path.join(temp, `${name}-http.hpp`);
  const mqttHeader = path.join(temp, `${name}-mqtt.hpp`);
  fs.writeFileSync(httpHeader, `${uintBody}\n\n${http}\n`);
  fs.writeFileSync(mqttHeader, `${mqtt}\n`);
  const binary = path.join(temp, name);
  execute(process.env.CXX || "c++", [
    "-std=c++17", "-Wall", "-Wextra", "-Werror", `-I${path.join(root, "main")}`,
    `-DHUB_HTTP_CONSUMERS=${JSON.stringify(httpHeader)}`,
    `-DHUB_MQTT_CONSUMER=${JSON.stringify(mqttHeader)}`, fixture, "-o", binary,
  ]);
  return binary;
}

function observe(binary, consumer) {
  const cases = new Map();
  for (const line of execute(binary, [consumer]).trim().split("\n")) {
    const entry = JSON.parse(line);
    assert.equal(typeof entry.case, "string");
    assert(!cases.has(entry.case), `duplicate fixture observation ${entry.case}`);
    cases.set(entry.case, entry.value);
  }
  return cases;
}

function absent(row, ...keys) {
  for (const key of keys) assert(!Object.hasOwn(row, key), `unexpected ${key}: ${JSON.stringify(row)}`);
}

const nativeMqtt = {
  quiet_mode_selection: 1, current_operation_mode: 0, imposed_power_limit: 2.5,
  heat_pump_power_consumption: 3.5, demand_response_mode: 3, unit_operation_mode: 7,
  unit_abnormality_code: "12",
};

const oracles = {
  "http-same-offset": (rows) => {
    assert.equal(rows.length, 6);
    assert.equal(rows[0].enum, "current_operation_mode");
    assert.equal(rows[0].value, 1);
    absent(rows[0], "profile", "binary");
    assert.equal(rows[1].enum, "altherma4_current_operation_mode");
    assert.equal(rows[1].value, 0);
    assert.equal(rows[1].profile, "altherma4");
    absent(rows[1], "binary");
    assert.equal(rows[2].binary, true);
    assert.equal(rows[2].concept, "quiet_state");
    assert.equal(rows[2].history, "quiet_state");
    absent(rows[2], "enum", "profile");
    assert.equal(rows[3].enum, "altherma4_quiet_selection");
    assert.equal(rows[3].profile, "altherma4");
    assert.equal(rows[3].value, 1);
    absent(rows[3], "binary", "concept", "history");
    assert.equal(rows[4].label, "General power limit");
    assert.equal(rows[5].label, "Imposed power limit");
    assert.equal(rows[4].value, 2.5);
    assert.equal(rows[5].value, 2.5);
    assert.equal(rows[5].profile, "altherma4");
  },
  "http-typed": (rows) => {
    assert.deepEqual(rows.slice(0, 3).map((row) => [row.value, row.enum]), [
      [7, "altherma4_current_operation_mode"], [3, "altherma4_demand_response"],
      [7, "altherma4_unit_operation_mode"],
    ]);
    for (const row of rows.slice(0, 3)) absent(row, "binary");
    assert.equal(rows[3].value, 1);
    assert.equal(rows[3].binary, true);
    assert.equal(rows[4].value, "12");
    assert.equal(rows[5].value, 'A"\\\n');
    assert.equal(rows[6].value, null);
    assert.equal(rows[6].enum, "altherma4_demand_response");
    assert.equal(rows[7].value, null);
  },
  "http-invalid": (rows) => {
    assert.equal(rows.length, 3);
    for (const row of rows) {
      assert.equal(row.value, null);
      absent(row, "binary", "enum", "profile", "concept", "history");
    }
  },
  "http-owned-snapshot": (rows) => {
    assert.equal(rows.length, 7);
    assert.equal(rows[0].enum, "altherma4_quiet_selection");
    absent(rows[0], "binary", "concept", "history");
    assert.equal(rows[1].enum, "altherma4_current_operation_mode");
    assert.equal(rows[1].value, 0);
    assert.equal(rows[2].label, "Imposed power limit");
    assert.equal(rows[3].label, "Heat pump power consumption");
    for (const row of rows) assert.equal(row.profile, "altherma4");
    assert.equal(rows[6].value, "12");
  },
  "http-profile-calls": (count) => assert.equal(count, 0),
  "mqtt-base": (value) => assert.deepEqual(value, {
    current_operation_mode: 1, quiet_mode_operation: 1, general_power_limit: 2.5,
  }),
  "mqtt-native": (value) => assert.deepEqual(value, nativeMqtt),
  "mqtt-typed": (value) => assert.deepEqual(value, {
    current_operation_mode: 7, demand_response_mode: 3, unit_operation_mode: 7,
    circulation_pump_running: 1, unit_abnormality_code: "12",
  }),
  "mqtt-escaped-text": (value) => assert.deepEqual(value, { unit_abnormality_code: 'A"\\\n' }),
  "mqtt-missing": (value) => assert.deepEqual(value, { current_operation_mode: null }),
  "mqtt-invalid": (value) => assert.deepEqual(value, {}),
  "mqtt-not-live": (value) => assert.deepEqual(value, {}),
  "mqtt-owned-snapshot": (value) => assert.deepEqual(value, nativeMqtt),
  "mqtt-profile-calls": (count) => assert.equal(count, 0),
};

function check(cases, name) {
  assert(cases.has(name), `missing production observation ${name}`);
  oracles[name](cases.get(name));
}

function mutate(body, before, after, name) {
  assert.equal(body.split(before).length - 1, 1, `${name}: mutation anchor must be unique`);
  return body.replace(before, after);
}

const temp = fs.mkdtempSync(path.join(os.tmpdir(), "daikin-modbus-metadata-"));
try {
  const production = compile("production");
  let passed = 0;
  for (const consumer of ["http", "mqtt"]) {
    const cases = observe(production, consumer);
    const expected = Object.keys(oracles).filter((name) => name.startsWith(`${consumer}-`));
    assert.deepEqual([...cases.keys()].sort(), expected.sort());
    for (const name of expected) { check(cases, name); passed++; }
  }

  const controls = [
    { name: "http-offset-lookup", consumer: "http", oracle: "http-same-offset",
      before: "def::homehub_definition(v[i].modbus_definition)", after: "def::homehub_find(v[i].off)" },
    { name: "mqtt-offset-lookup", consumer: "mqtt", oracle: "mqtt-native",
      before: "def::homehub_definition(cache[i].modbus_definition)", after: "def::homehub_find(cache[i].off)" },
    { name: "http-quiet-reassignment", consumer: "http", oracle: "http-same-offset",
      before: "if (reg && reg->offset != v[i].off) reg = nullptr;",
      after: "if (reg && reg->offset != v[i].off) reg = nullptr;\n        if (reg && reg->offset == 9) reg = def::homehub_find(9);" },
    { name: "mqtt-quiet-reassignment", consumer: "mqtt", oracle: "mqtt-native",
      before: "if (reg && reg->offset != cache[i].off) reg = nullptr;",
      after: "if (reg && reg->offset != cache[i].off) reg = nullptr;\n        if (reg && reg->offset == 9) reg = def::homehub_find(9);" },
    { name: "http-offset-guard", consumer: "http", oracle: "http-invalid",
      before: "if (reg && reg->offset != v[i].off) reg = nullptr;", after: "/* mutation: no offset guard */" },
    { name: "mqtt-offset-guard", consumer: "mqtt", oracle: "mqtt-invalid",
      before: "if (reg && reg->offset != cache[i].off) reg = nullptr;", after: "/* mutation: no offset guard */" },
    { name: "http-current-profile", consumer: "http", oracle: "http-owned-snapshot",
      before: "def::homehub_definition_is_altherma4(v[i].modbus_definition)",
      after: "(mb_active_profile() == ModbusProfile::Altherma4)" },
    { name: "mqtt-current-profile", consumer: "mqtt", oracle: "mqtt-owned-snapshot",
      before: "def::homehub_definition(cache[i].modbus_definition)",
      after: "(mb_active_profile() == ModbusProfile::Altherma4 ? def::altherma4_find(cache[i].off) : def::homehub_find(cache[i].off))" },
  ];
  for (const control of controls) {
    const body = mutate(control.consumer === "http" ? httpBody : mqttBody,
      control.before, control.after, control.name);
    // Compilation, execution, JSON parsing and adapter failures are fatal, not a detected mutation.
    const binary = compile(control.name,
      control.consumer === "http" ? body : httpBody,
      control.consumer === "mqtt" ? body : mqttBody);
    const cases = observe(binary, control.consumer);
    assert.throws(() => check(cases, control.oracle), { code: "ERR_ASSERTION" },
      `${control.name} must fail its specific semantic oracle ${control.oracle}`);
  }
  for (const [file, content] of productionInputs)
    assert.equal(fs.readFileSync(file, "utf8"), content,
      `${path.relative(root, file)} changed during the production consumer test`);
  const hash = (source) => createHash("sha256").update(source).digest("hex");
  console.log(`Modbus metadata production consumers: ${passed} cases, ${controls.length} detected mutation controls`);
  console.log(`Extracted append_json_uint + append_modbus_values_array: ${hash(`${uintBody}\n\n${httpBody}\n`)}`);
  console.log(`Extracted current_modbus_values: ${hash(mqttBody)}`);
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}
