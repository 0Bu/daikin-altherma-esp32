// Full production ENV III / Weather TUs, followed by temporary source mutations. The default
// cJSON adapter has no lexer; --real-cjson <managed cJSON directory> adds the lock-resolved lexer.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const files = {
  env3: path.join(root, "main/env3.cpp"),
  weather: path.join(root, "main/weather_forecast.cpp"),
  epoch: path.join(root, "main/logic/open_meteo.hpp"),
};
const sources = Object.fromEntries(Object.entries(files).map(([key, file]) => [key, fs.readFileSync(file, "utf8")]));
const args = process.argv.slice(2);
assert.ok(args.length === 0 || (args.length === 2 && args[0] === "--real-cjson"),
  "usage: node test/test_src_runtime.mjs [--real-cjson managed_components/espressif__cjson/cJSON]");
const cjsonDir = args.length ? path.resolve(root, args[1]) : null;
if (cjsonDir) {
  assert.equal(cjsonDir, path.join(root, "managed_components/espressif__cjson/cJSON"),
    "real cJSON must be the repository's lock-resolved managed component");
  assert.match(fs.readFileSync(path.join(root, "dependencies.lock"), "utf8"),
    /espressif\/cjson:[\s\S]*?version: 1\.7\.19~2/);
}
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "daikin-src-runtime-"));
function execute(command, args, timeout = 30000) {
  const result = spawnSync(command, args, { cwd: root, encoding: "utf8", timeout, maxBuffer: 1024 * 1024 });
  assert.ifError(result.error);
  assert.equal(result.signal, null, `${command}: terminated\n${result.stdout}${result.stderr}`);
  return result;
}
let cjsonObject;
function compile(name, file, override) {
  const binary = path.join(temp, name);
  const real = file === "weather" && cjsonDir;
  const options = ["-std=c++17", "-Wall", "-Wextra", "-Werror"];
  if (real) options.push("-DWEATHER_REAL_CJSON", `-I${cjsonDir}`);
  const define = file === "env3" ? "ENV3_PRODUCTION_SOURCE" : "WEATHER_PRODUCTION_SOURCE";
  options.push(`-D${define}=${JSON.stringify(override || files[file])}`,
    `-I${path.join(root, `test/${file === "env3" ? "env3" : "weather"}_runtime/stubs`)}`,
    `-I${path.join(root, "main")}`,
    path.join(root, `test/${file === "env3" ? "env3" : "weather"}_runtime/fixture.cpp`));
  if (real) options.push(cjsonObject);
  options.push("-o", binary);
  const result = execute(process.env.CXX || "c++", options);
  assert.equal(result.status, 0, `${name}: complete production TU must compile\n${result.stdout}${result.stderr}`);
  return binary;
}
function mutate(mutation) {
  const source = sources[mutation.file];
  assert.equal(source.split(mutation.before).length - 1, 1, `${mutation.name}: unique source anchor required`);
  const mutated = path.join(temp, `${mutation.name}.${mutation.file === "epoch" ? "hpp" : "cpp"}`);
  fs.writeFileSync(mutated, source.replace(mutation.before, mutation.after));
  if (mutation.file !== "epoch") return mutated;
  // Original quoted includes search the TU directory first. Bind the changed helper explicitly.
  const weather = path.join(temp, `${mutation.name}-weather.cpp`);
  fs.writeFileSync(weather, sources.weather.replace('"logic/open_meteo.hpp"', JSON.stringify(mutated)));
  return weather;
}
const mutations = [
  {
    name: "env3-board-boundary", file: "env3", scenario: "board_start",
    before: "if (!cfg.env3_enabled || !env3_board_supported(cfg)) return;",
    after: "if (!cfg.env3_enabled) return;",
  },
  {
    name: "env3-probe-cleanup", file: "env3", scenario: "probe_success",
    before: "delete_bus(sensor);", after: "/* mutation: abandon short-lived probe handles */",
  },
  {
    name: "env3-probe-chip-id", file: "env3", scenario: "probe_chip_crc",
    before: "qmp_ok = read_reg(sensor.qmp, 0xd1, &chip_id, 1) == ESP_OK && chip_id == 0x5c;",
    after: "qmp_ok = read_reg(sensor.qmp, 0xd1, &chip_id, 1) == ESP_OK;",
  },
  {
    name: "env3-probe-crc", file: "env3", scenario: "probe_chip_crc",
    before: "sht_ok = env3_decode_sht30(raw, temperature, humidity);",
    after: "sht_ok = (static_cast<void>(env3_decode_sht30(raw, temperature, humidity)), true);",
  },
  {
    name: "env3-fresh-age", file: "env3", scenario: "sample_lifecycle",
    before: "age_us <= FRESH_US", after: "age_us <= FRESH_US + 1",
  },
  {
    // Restore the confirmed original task-start Config allocation. The adapter throws only on
    // that service snapshot, after env3_start has completed its own safe startup copy.
    name: "env3-task-config-allocation", file: "env3", scenario: "task_config_oom",
    before: "const TaskPins pins = *static_cast<const TaskPins*>(argument);",
    after: "(void)argument; const Config cfg = config(); const TaskPins pins{cfg.env3_sda, cfg.env3_scl};",
  },
  {
    name: "weather-exclusive-epoch-bound", file: "epoch", scenario: "epoch_bounds",
    before: "value >= 0x1p63", after: "value > 0x1p63",
  },
  {
    name: "weather-json-cleanup", file: "weather", scenario: "json_cleanup",
    before: "~JsonCleanup() { cJSON_Delete(root); }", after: "~JsonCleanup() {}",
  },
  {
    name: "weather-http-cleanup", file: "weather", scenario: "transport_success",
    before: "esp_http_client_cleanup(handle);", after: "/* mutation: leak HTTP owner */",
  },
  {
    name: "weather-body-completion", file: "weather", scenario: "transport_completion",
    before: "if (!complete) {", after: "if ((static_cast<void>(complete), false)) {",
  },
  {
    name: "weather-body-cap", file: "weather", scenario: "transport_body_cap",
    before: "constexpr size_t kPayloadMax = 8 * 1024;", after: "constexpr size_t kPayloadMax = 16 * 1024;",
  },
  {
    name: "weather-absolute-deadline", file: "weather", scenario: "transport_deadline",
    before: "constexpr TickType_t kDownloadDeadline = pdMS_TO_TICKS(60000);",
    after: "constexpr TickType_t kDownloadDeadline = pdMS_TO_TICKS(600000);",
  },
  {
    name: "weather-source-invalidation", file: "weather", scenario: "source_transaction",
    before: "replacement.has_value             = false;", after: "replacement.has_value             = true;",
  },
  {
    name: "weather-source-generation", file: "weather", scenario: "source_transaction",
    before: "s_source_generation.fetch_add(1, std::memory_order_acq_rel);",
    after: "/* mutation: leave old generation authoritative */",
  },
  {
    name: "weather-stale-result", file: "weather", scenario: "source_admission_generation",
    before: "if (s_source_generation.load(std::memory_order_acquire) != expected_generation) return false;",
    after: "(void)expected_generation; /* mutation: stale invalidation may erase replacement */",
  },
  {
    name: "weather-rejected-overwrites-sample", file: "weather", scenario: "task_rejected_retains_sample",
    before: "s_status.error = failure;",
    after: "s_status.error = failure; s_status.fetched_unix_s = -1;",
  },
];
try {
  if (cjsonDir) {
    cjsonObject = path.join(temp, "cjson.o");
    const result = execute(process.env.CC || "cc", ["-std=c99", "-I", cjsonDir, "-c",
      path.join(cjsonDir, "cJSON.c"), "-o", cjsonObject]);
    assert.equal(result.status, 0, `lock-resolved cJSON must compile\n${result.stdout}${result.stderr}`);
  }
  for (const [file, count] of [["env3", 8], ["weather", 17]]) {
    const binary = compile(`production-${file}`, file);
    const result = execute(binary, []);
    assert.equal(result.status, 0, `${result.stdout}${result.stderr}`);
    assert.match(result.stdout, new RegExp(`PASS total=${count}\\b`));
    console.log(result.stdout.trim());
    if (file === "weather" && cjsonDir) {
      const lexed = execute(binary, ["real_lexer"]);
      assert.equal(lexed.status, 0, `${lexed.stdout}${lexed.stderr}`);
      console.log(lexed.stdout.trim());
    }
  }
  for (const mutation of mutations) {
    const file = mutation.file === "epoch" ? "weather" : mutation.file;
    const result = execute(compile(mutation.name, file, mutate(mutation)), [mutation.scenario]);
    assert.equal(result.status, 1, `${mutation.name}: named oracle must reject mutation\n${result.stdout}${result.stderr}`);
    assert.match(result.stderr, new RegExp(`^FAIL ${mutation.scenario}:`, "m"));
    console.log(`negative control ${mutation.name}: rejected by ${mutation.scenario}`);
  }
  for (const [key, source] of Object.entries(sources))
    console.log(`source runtime ${key} sha256=${createHash("sha256").update(source).digest("hex")}`);
  if (cjsonDir) console.log(`source runtime cJSON.c sha256=${createHash("sha256").update(fs.readFileSync(path.join(cjsonDir, "cJSON.c"))).digest("hex")}`);
  console.log(`production source runtime: 25 cases, ${mutations.length} negative controls, ${cjsonDir ? "real lock-resolved cJSON plus lexer corpus" : "AST adapter; no JSON lexer"}`);
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}
