// Execute the entire production OTA TU. Never count an uncompilable mutant or a crash as a kill.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fixture = path.join(root, "test/ota_runtime/fixture.cpp");
const sourcePath = path.join(root, "main/ota_update.cpp");
const source = fs.readFileSync(sourcePath, "utf8");
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "daikin-ota-runtime-"));
const compiler = process.env.CXX || "c++";

function execute(command, args, timeout = 30000) {
  const result = spawnSync(command, args, {
    cwd: root, encoding: "utf8", timeout, maxBuffer: 1024 * 1024,
  });
  assert.ifError(result.error);
  assert.equal(result.signal, null, `${command} was terminated: ${result.stdout}${result.stderr}`);
  return result;
}
function compile(production, name) {
  const binary = path.join(dir, `${name}.bin`);
  const result = execute(compiler, [
    "-std=c++17", "-pthread", "-Wall", "-Wextra", "-Werror",
    `-DOTA_PRODUCTION_SOURCE=${JSON.stringify(production)}`,
    `-I${path.join(root, "test/ota_runtime/stubs")}`,
    `-I${path.dirname(production)}`,
    `-I${path.join(root, "main")}`, fixture, "-o", binary,
  ]);
  assert.equal(result.status, 0, `${name}: full production TU must compile\n${result.stdout}${result.stderr}`);
  return binary;
}
function replaceOnce(text, before, after, name) {
  const count = typeof before === "string"
    ? text.split(before).length - 1
    : [...text.matchAll(new RegExp(before.source, before.flags + "g"))].length;
  assert.equal(count, 1, `${name}: mutation anchor must be unique`);
  return text.replace(before, after);
}

try {
  const baseline = execute(compile(sourcePath, "production"), []);
  assert.equal(baseline.status, 0, `production OTA cases\n${baseline.stdout}${baseline.stderr}`);
  assert.match(baseline.stdout, /PASS total=48\b/);
  console.log(baseline.stdout.trim());

  const mutations = [
    {
      name: "mutex-heap-allocation", scenario: "mutex_storage",
      before: "SemaphoreHandle_t s_mtx = xSemaphoreCreateMutexStatic(&s_mtx_storage);",
      after: "[[maybe_unused]] int fixture_storage_use = (static_cast<void>(s_mtx_storage), 0);\nSemaphoreHandle_t s_mtx = xSemaphoreCreateMutex();",
    },
    {
      name: "health-runtime-stack", scenario: "health_static_storage",
      before: /!xTaskCreateStatic\(health_gate_task,\s*"ota_health",\s*kHealthTaskStack,\s*nullptr,\s*TASK_PRIO_OTA_GATE,\s*s_ota_health_task_stack,\s*&s_ota_health_task_storage\)/,
      after: '(static_cast<void>(s_ota_health_task_stack), static_cast<void>(s_ota_health_task_storage), xTaskCreate(health_gate_task, "ota_health", kHealthTaskStack, nullptr, TASK_PRIO_OTA_GATE, nullptr) != pdPASS)',
    },
    {
      name: "health-storage-rearm", scenario: "health_static_storage",
      before: "if (s_health_gate_armed.exchange(true, std::memory_order_acq_rel)) return;",
      after: "/* mutation: allow a second task to reuse health storage */",
    },
    {
      name: "health-stack-budget", scenario: "health_static_storage",
      before: "static constexpr int kHealthTaskStack = 4096;",
      after: "static constexpr int kHealthTaskStack = 3072;",
    },
    {
      name: "unwind-buffer", scenario: "header_exception",
      before: /(~OtaUpdateResources\(\)\s*\{\s*)release_buffer\(\);/,
      after: "$1/* mutation: omit final buffer release */",
    },
    {
      name: "unwind-http", scenario: "header_exception",
      before: /(~OtaUpdateResources\(\)[\s\S]*?)close_http_client\(client, socket_deadline\);/,
      after: "$1/* mutation: omit final HTTP release */",
    },
    {
      name: "unwind-hash", scenario: "hash_exception",
      before: "if (hash_active) psa_hash_abort(&hash_operation);",
      after: "/* mutation: omit final PSA abort */",
    },
    {
      name: "unwind-ota", scenario: "header_exception",
      before: "if (ota_open) esp_ota_abort(ota_handle);",
      after: "/* mutation: omit final OTA abort */",
    },
    {
      name: "join-before-cleanup", scenario: "header_exception",
      before: "(void)deadline.disarm();",
      after: "(void)deadline; /* mutation: release the client before joining its deadline */",
    },
    {
      name: "network-lease", scenario: "header_exception",
      before: "s_network_active.store(false, std::memory_order_release);",
      after: "/* mutation: retain the network lease */",
    },
    {
      name: "mqtt-resume", scenario: "header_exception",
      before: "mqtt_transport_resume_after_network_heap();",
      after: "/* mutation: omit MQTT resume */",
    },
    {
      name: "busy-tail", scenario: "header_exception",
      before: /^ {12}s_busy = false;$/m,
      after: "/* mutation: retain busy after the worker catches OOM */",
    },
    {
      name: "consumed-end-handle", scenario: "validation_error",
      before: /ota_open = false;\n\s*e\s*= esp_ota_end\(ota_handle\);/,
      after: "e = esp_ota_end(ota_handle); /* mutation: retain a consumed OTA handle */",
    },
    {
      name: "embedded-version-binding", scenario: "image_binding",
      before: "if (!ota_artifact_versions_match(avail, imgver)) {",
      after: "if ((ota_artifact_versions_match(avail, imgver), false)) {",
    },
    {
      name: "resumed-range-binding", scenario: "wrong_range",
      before: "if (!range_ok || esp_http_client_is_chunked_response(client)",
      after: "if ((static_cast<void>(range_ok), false) || esp_http_client_is_chunked_response(client)",
    },
    {
      name: "health-minimum", scenario: "health_commit",
      before: /kHealthBaseWindowS\s*= 90;/,
      after: "kHealthBaseWindowS = 0;",
    },
    {
      name: "health-hard-cap", scenario: "health_timeout",
      before: /kHealthHardCapS\s*= 600;/,
      after: "kHealthHardCapS = 300;",
    },
    {
      name: "health-heap-wiring", scenario: "health_low_block",
      before: "ota_health_heap_ready(free_bytes, largest)",
      after: "(ota_health_heap_ready(free_bytes, largest), true)",
    },
    ...[
      ["heap_guard_restarts() != 0", "health_heap_restart"],
      ["mqtt_skips.skipped != 0", "health_mqtt_skip"],
      ["hp_skipped_cycles() != 0", "health_poll_skip"],
    ].map(([term, scenario]) => ({
      name: scenario, scenario, before: term, after: `(static_cast<void>(${term}), false)`,
    })),
    {
      name: "health-x10a-wiring", scenario: "health_x10a_missing",
      before: "hp_link_connected() && mqtt_x10a_publish_required()",
      after: "(static_cast<void>(hp_link_connected() && mqtt_x10a_publish_required()), false)",
    },
    {
      name: "health-publish-wiring", scenario: "health_x10a_missing",
      before: "= mqtt_x10a_publish_proven(),",
      after: "= (mqtt_x10a_publish_proven(), true),",
    },
    {
      name: "health-recovery-wiring", scenario: "health_ap_recovery",
      before: "= provisioning_ap_active(),",
      after: "= (provisioning_ap_active(), false),",
    },
    ...["poll", "mqtt", "mqtt_transport", "modbus", "syslog", "weather"].map((owner, index) => ({
      name: `owner-ack-${owner}`, scenario: `quiesce_${index + 1}`,
      before: `if (!wait_for_${owner}_quiesce()) {`,
      after: `if ((wait_for_${owner}_quiesce(), false)) {`,
    })),
    {
      name: "manifest-root-close", scenario: "manifest_bounds", header: "ota_manifest.hpp",
      before: /(Only the closing-brace path above may publish an accepted identity\.\n\s*)return false;/,
      after: "$1return i == len && have_version && have_provenance && have_sha;",
    },
    {
      name: "manifest-depth", scenario: "manifest_bounds", header: "ota_manifest.hpp",
      before: "MAX_JSON_DEPTH = 8;", after: "MAX_JSON_DEPTH = 9;",
    },
    {
      name: "allocating-artifact-helper", scenario: "helpers_no_allocation", header: "version_cmp.hpp",
      before: "inline bool ota_artifact_versions_match(const char* manifest, const char* image) {",
      after: "inline bool ota_artifact_versions_match(const char* manifest, const char* image) {\n"
        + "    const std::string temporary(image); (void)temporary;",
    },
    {
      name: "allocating-order-helper", scenario: "helpers_no_allocation", header: "version_cmp.hpp",
      before: "inline bool ota_install_allowed(const char* running, const char* candidate, bool allow_downgrade) {",
      after: "inline bool ota_install_allowed(const char* running, const char* candidate, bool allow_downgrade) {\n"
        + "    const std::string temporary(candidate); (void)temporary;",
    },
  ];
  for (const mutation of mutations) {
    const mainDir = path.join(dir, mutation.name, "main");
    fs.mkdirSync(path.join(mainDir, "logic"), { recursive: true });
    const production = path.join(mainDir, "ota_update.cpp");
    if (mutation.header) {
      // Quoted transitive includes must see the same mutant header, before #pragma once pins it.
      // Copy the project header closure, never load both the original and mutant definitions.
      fs.cpSync(path.join(root, "main"), mainDir, {
        recursive: true,
        filter: (file) => fs.statSync(file).isDirectory() || /\.(hpp|h)$/.test(file),
      });
      fs.writeFileSync(production, source);
      const header = fs.readFileSync(path.join(root, "main/logic", mutation.header), "utf8");
      fs.writeFileSync(path.join(mainDir, "logic", mutation.header),
        replaceOnce(header, mutation.before, mutation.after, mutation.name));
    } else {
      fs.writeFileSync(production, replaceOnce(source, mutation.before, mutation.after, mutation.name));
    }
    const result = execute(compile(production, mutation.name), [mutation.scenario]);
    assert.equal(result.status, 1,
      `${mutation.name}: its behavioral oracle must reject the mutation\n${result.stdout}${result.stderr}`);
    assert.match(result.stderr, new RegExp(`^ASSERT ${mutation.scenario}:`, "m"),
      `${mutation.name}: only the specific assertion failure counts`);
    console.log(`negative control ${mutation.name}: rejected by ${mutation.scenario}`);
  }
  console.log(`production OTA runtime: 48 cases, ${mutations.length} negative controls; source sha256=`
    + createHash("sha256").update(source).digest("hex"));
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}
