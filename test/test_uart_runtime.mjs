// Complete production UART TU with real pure classifiers, plus named temporary mutations.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const files = {
  uart: path.join(root, "main/hp_comm.cpp"),
  header: path.join(root, "main/hp_comm.hpp"),
  detect: path.join(root, "main/logic/detect.hpp"),
  probe: path.join(root, "main/logic/hp_probe.hpp"),
  log: path.join(root, "main/logic/hp_query_log.hpp"),
  crc: path.join(root, "main/logic/crc.hpp"),
};
const sources = Object.fromEntries(Object.entries(files).map(([key, file]) => [key, fs.readFileSync(file, "utf8")]));
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "daikin-uart-runtime-"));
function execute(command, args, timeout = 30000) {
  const result = spawnSync(command, args, { cwd: root, encoding: "utf8", timeout, maxBuffer: 1024 * 1024 });
  assert.ifError(result.error);
  assert.equal(result.signal, null, `${command}: terminated\n${result.stdout}${result.stderr}`);
  return result;
}
function compile(name, overrides = {}) {
  const bound = { ...files, ...overrides };
  const binary = path.join(temp, name);
  const result = execute(process.env.CXX || "c++", [
    "-std=c++17", "-Wall", "-Wextra", "-Werror",
    `-DUART_PRODUCTION_SOURCE=${JSON.stringify(bound.uart)}`,
    `-DUART_DETECT_SOURCE=${JSON.stringify(bound.detect)}`,
    `-DUART_PROBE_SOURCE=${JSON.stringify(bound.probe)}`,
    `-I${path.join(root, "test/uart_runtime/stubs")}`,
    `-I${path.join(root, "main")}`, `-I${path.join(root, "main/logic")}`,
    path.join(root, "test/uart_runtime/fixture.cpp"), "-o", binary,
  ]);
  assert.equal(result.status, 0, `${name}: complete production TU must compile\n${result.stdout}${result.stderr}`);
  return binary;
}
function mutate(mutation) {
  const source = sources[mutation.file];
  assert.equal(source.split(mutation.before).length - 1, 1,
    `${mutation.name}: unique source anchor required`);
  const changed = path.join(temp, `${mutation.name}.${mutation.file === "uart" ? "cpp" : "hpp"}`);
  fs.writeFileSync(changed, source.replace(mutation.before, mutation.after));
  if (["uart", "detect", "probe"].includes(mutation.file)) return { [mutation.file]: changed };
  // Bind a changed header through a copied public UART header and copied TU. Quoted includes
  // otherwise search the production file's directory first, silently defeating the mutation.
  const header = path.join(temp, `${mutation.name}-hp_comm.hpp`);
  const declaration = mutation.file === "header" ? changed : header;
  if (mutation.file !== "header") {
    assert.equal(mutation.file, "log", "only the public declaration/log policy uses this binding");
    fs.writeFileSync(header, sources.header.replace('"logic/hp_query_log.hpp"', JSON.stringify(changed)));
  }
  const uart = path.join(temp, `${mutation.name}-hp_comm.cpp`);
  fs.writeFileSync(uart, sources.uart.replace('"hp_comm.hpp"', JSON.stringify(declaration)));
  return { uart };
}
const mutations = [
  {
    name: "flush-result", file: "uart", scenario: "missing_driver",
    before: 'if (flushed != ESP_OK) return uart_error(reg, "flush", flushed, 0, log_policy);',
    after: 'if ((static_cast<void>(flushed), false)) return uart_error(reg, "flush", flushed, 0, log_policy);',
  },
  {
    name: "write-result", file: "uart", scenario: "write_error",
    before: 'if (written != qlen) return uart_error(reg, "write", written, 0, log_policy);',
    after: 'if ((static_cast<void>(written), false)) return uart_error(reg, "write", written, 0, log_policy);',
  },
  {
    name: "tx-completion-result", file: "uart", scenario: "wait_error",
    before: 'if (sent != ESP_OK) return uart_error(reg, "wait", sent, 0, log_policy);',
    after: 'if ((static_cast<void>(sent), false)) return uart_error(reg, "wait", sent, 0, log_policy);',
  },
  {
    name: "negative-header-read", file: "uart", scenario: "header_read_error",
    before: 'return uart_error(reg, "read", read_res, len, log_policy);', after: "break;",
  },
  {
    name: "negative-bulk-read", file: "uart", scenario: "bulk_read_error",
    before: 'return uart_error(reg, "read", read, len, log_policy);', after: "break;",
  },
  {
    name: "driver-error-classification", file: "uart", scenario: "header_read_error",
    before: "return {HpReplyKind::DriverError, received};", after: "return {HpReplyKind::NoReply, received};",
  },
  {
    name: "driver-error-partial-count", file: "uart", scenario: "bulk_read_error",
    before: "return {HpReplyKind::DriverError, received};",
    after: "(void)received; return {HpReplyKind::DriverError, 0};",
  },
  {
    name: "driver-error-diagnostic", file: "uart", scenario: "header_read_error",
    before: "if (hp_query_should_log(log_policy, HpQueryFailure::DriverError))",
    after: "if ((static_cast<void>(log_policy), false))",
  },
  {
    name: "driver-error-detection-policy", file: "log", scenario: "error_policies",
    before: "failure != HpQueryFailure::Rejected)",
    after: "failure != HpQueryFailure::Rejected && failure != HpQueryFailure::DriverError)",
  },
  {
    name: "driver-error-detection-count", file: "detect", scenario: "driver_mapping",
    before: "kind == HpReplyKind::DriverError", after: "false",
  },
  {
    name: "driver-error-probe-status", file: "probe", scenario: "driver_mapping",
    before: "case HpReplyKind::DriverError:\n            return ProbeStatus::NoLink;",
    after: "case HpReplyKind::DriverError:\n            return ProbeStatus::NoReply;",
  },
  {
    name: "legacy-error-integer", file: "uart", scenario: "legacy_results",
    before: "default:\n        return -1;", after: "default:\n        return -4;",
  },
  {
    name: "query-deadline", file: "header", scenario: "silence",
    before: "HP_QUERY_TIMEOUT_US = 300000;", after: "HP_QUERY_TIMEOUT_US = 600000;",
  },
  {
    name: "hidden-request-resend", file: "uart", scenario: "protocol_i",
    before: "const int written = uart_write_bytes(PORT, reinterpret_cast<const char*>(req), qlen);",
    after: "const int written = uart_write_bytes(PORT, reinterpret_cast<const char*>(req), qlen);\n    uart_write_bytes(PORT, reinterpret_cast<const char*>(req), qlen);",
  },
];
try {
  const result = execute(compile("production"), []);
  assert.equal(result.status, 0, `${result.stdout}${result.stderr}`);
  assert.match(result.stdout, /PASS total=22\b/);
  console.log(result.stdout.trim());
  for (const mutation of mutations) {
    const negative = execute(compile(mutation.name, mutate(mutation)), [mutation.scenario]);
    assert.equal(negative.status, 1,
      `${mutation.name}: named runtime assertion must reject mutation\n${negative.stdout}${negative.stderr}`);
    assert.match(negative.stderr, new RegExp(`^FAIL ${mutation.scenario}:`, "m"));
    console.log(`negative control ${mutation.name}: rejected by ${mutation.scenario}`);
  }
  for (const [key, source] of Object.entries(sources))
    console.log(`UART runtime ${key} sha256=${createHash("sha256").update(source).digest("hex")}`);
  console.log(`production UART runtime: 22 cases, ${mutations.length} negative controls`);
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}
