// Compile the entire current production Modbus component and execute it over real POSIX sockets.
// SDK-shaped adapters provide an explicit clock and task schedule; see modbus_runtime/README.md.
import assert from "node:assert/strict";
import { semanticMutations } from "./modbus_runtime/semantic_mutations.mjs";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fixture = path.join(root, "test/modbus_runtime/fixture.cpp");
const sourcePath = path.join(root, "main/hp_modbus.cpp");
const source = fs.readFileSync(sourcePath, "utf8");
const sourceHash = createHash("sha256").update(source).digest("hex");
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "daikin-modbus-runtime-"));
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
  const binary = path.join(dir, name);
  const result = execute(compiler, [
    "-std=c++17", "-pthread", "-Wall", "-Wextra", "-Werror",
    `-DHUB_PRODUCTION_SOURCE=${JSON.stringify(production)}`,
    `-I${path.join(root, "test/modbus_runtime/stubs")}`,
    `-I${path.join(root, "main")}`, fixture, "-o", binary,
  ]);
  assert.equal(result.status, 0, `${name}: full production TU must compile\n${result.stdout}${result.stderr}`);
  return binary;
}

function mutateOnce(before, after, name) {
  const count = typeof before === "string"
    ? source.split(before).length - 1
    : [...source.matchAll(new RegExp(before.source, before.flags + "g"))].length;
  assert.equal(count, 1, `${name}: mutation anchor must be unique`);
  const mutated = path.join(dir, `${name}.cpp`);
  fs.writeFileSync(mutated, source.replace(before, after));
  return mutated;
}

try {
  const binary = compile(sourcePath, "production");
  const baseline = execute(binary, [], 20000);
  assert.equal(baseline.status, 0, `production runtime cases\n${baseline.stdout}${baseline.stderr}`);
  const baselineCount = 44;
  assert.match(baseline.stdout, new RegExp(`PASS total=${baselineCount}\\b`));
  console.log(baseline.stdout.trim());

  // A successfully compiled mutation must fail its particular behavioral oracle. A crash,
  // compilation failure or another test failure cannot count as evidence that the oracle works.
  const mutations = [
    ...semanticMutations,
    {
      name: "dynamic-status-mutex", scenario: "lifecycle",
      before: "xSemaphoreCreateMutexStatic(&s_mtx_storage)",
      after: "((void)s_mtx_storage, xSemaphoreCreateMutex())",
    },
    {
      name: "dynamic-cache-mutex", scenario: "lifecycle",
      before: "xSemaphoreCreateMutexStatic(&s_cache_mtx_storage)",
      after: "((void)s_cache_mtx_storage, xSemaphoreCreateMutex())",
    },
    {
      name: "retiring-reports-active", scenario: "retiring_reenable",
      before: "return !s_task || !s_status.enabled || s_task_retiring;",
      after: "return !s_task || (!s_task_retiring && !s_status.enabled);",
    },
    {
      name: "retiring-drops-reenable", scenario: "retiring_reenable",
      before: "if (!s_target_enabled.load(std::memory_order_acquire)) return true;",
      after: "return true;",
    },
    {
      name: "retirement-releases-worker-before-cleanup", scenario: "retiring_reenable",
      before: "if (!s_target_enabled.load(std::memory_order_acquire)) return true;",
      after: "if (!s_target_enabled.load(std::memory_order_acquire)) { s_task = nullptr; return true; }",
    },
    {
      name: "worker-closes-during-tls-ownership", scenario: "task_oom_and_quiesce",
      before: /wait_for_tls\s*=\s*ota_active \|\| weather_fetch_active\(\);/,
      after: "wait_for_tls = false;",
    },
    {
      name: "worker-ignores-http-heap-reserve", scenario: "lifecycle",
      before: "heap_largest_internal_block() < startup_reserve ||",
      after: "false ||",
    },
    {
      name: "worker-ignores-total-heap-reserve", scenario: "lifecycle",
      before: "free_bytes < startup_reserve",
      after: "(static_cast<void>(free_bytes), false)",
    },
    {
      name: "worker-skips-first-sweep-heap-check", scenario: "first_sweep_heap_pressure",
      before: /heap_largest_internal_block\(\) >= MB_FIRST_SWEEP_HEAP &&\s*heap_caps_get_free_size\(MALLOC_CAP_8BIT \| MALLOC_CAP_INTERNAL\) >=\s*MB_FIRST_SWEEP_HEAP/,
      after: "true",
    },
    {
      name: "worker-admits-first-sweep-during-tls", scenario: "first_sweep_after_tls",
      before: /s_target_enabled\.load\(std::memory_order_acquire\) &&\s*!ota_download_active\(\) &&\s*!weather_fetch_active\(\)/,
      after: "s_target_enabled.load(std::memory_order_acquire)",
    },
    {
      name: "first-sweep-admission-consumed-by-attempt", scenario: "first_sweep_heap_pressure",
      before: "if (mb_poll_once(target, first_sweep_pending)) first_sweep_pending = false;",
      after: "first_sweep_pending = false; mb_poll_once(target, true);",
    },
    {
      name: "worker-admission-ignores-first-sweep-cost", scenario: "lifecycle",
      before: "stack_bytes + worker_setup_reserve + MB_FIRST_SWEEP_HEAP",
      after: "stack_bytes + worker_setup_reserve + HEAP_RECOVERY_BYTES",
    },
    {
      name: "poll-admits-replaced-target", scenario: "first_sweep_heap_pressure",
      before: /static bool mb_poll_once\(uint32_t cycle_target_generation, bool allow_reconnect\) \{\n    if \(s_target_generation\.load\(std::memory_order_acquire\) != cycle_target_generation\)\s*return false;/,
      after: "static bool mb_poll_once(uint32_t cycle_target_generation, bool allow_reconnect) {\n    cycle_target_generation = s_target_generation.load(std::memory_order_acquire);",
    },
    {
      name: "poll-dials-unadmitted-config", scenario: "first_sweep_heap_pressure",
      before: /if \(!allow_reconnect &&\s*\(host != s_req_host \|\| cfg\.mb_port != s_req_port \|\| cfg\.mb_unit_id != s_unit\)\)\s*return false;/,
      after: "(void)allow_reconnect;",
    },
    {
      name: "disabled-worker-retains-cache-allocation", scenario: "socket_setup_and_retirement",
      before: "s_cache.swap(invalidated_cache);",
      after: "s_cache.clear();",
    },
    {
      name: "disconnected-fast-poll-retains-cache-allocation", scenario: "poll_full_fast_break",
      before: /if \(!final_current_session\) mb_drop_cache\(cycle_target_generation\);\n        report_cycle_result/,
      after: "report_cycle_result",
    },
    {
      name: "allocate-before-retrying-invalid-socket", scenario: "socket_setup_and_retirement",
      before: /if \(s_sock >= 0 && \(!s_have_req \|\| s_req_target_generation != cycle_target_generation\) &&\s*!close_sock\(\)\)/,
      after: "if (false)",
    },
    {
      name: "admit-socket-without-timeouts", scenario: "socket_setup_and_retirement",
      before: /setsockopt\(sock, SOL_SOCKET, SO_RCVTIMEO, &rt, sizeof\(rt\)\) != 0 \|\|\s*setsockopt\(sock, SOL_SOCKET, SO_SNDTIMEO, &rt, sizeof\(rt\)\) != 0/,
      after: "(void)rt, false",
    },
    {
      name: "discard-socket-on-failed-close", scenario: "socket_setup_and_retirement",
      before: "if (s_sock >= 0 && close(s_sock) != 0 && errno != EBADF) return false;",
      after: "if (s_sock >= 0) (void)close(s_sock);",
    },
    {
      name: "worker-ignores-watchdog-add-failure", scenario: "worker_admission_pressure",
      before: "if (esp_task_wdt_add(nullptr) != ESP_OK)",
      after: "if ((void)esp_task_wdt_add(nullptr), false)",
    },
    {
      name: "worker-ignores-lwip-readiness", scenario: "worker_admission_pressure",
      before: "if (daikin_lwip_thread_sem_get() == nullptr)",
      after: "if ((void)daikin_lwip_thread_sem_get(), false)",
    },
    {
      name: "worker-reallocates-after-watchdog-failure", scenario: "worker_admission_pressure",
      before: "lwip_ready = true;",
      after: "lwip_ready = false;",
    },
    {
      name: "allocate-partial-sweep-diagnostic", scenario: "partial_sweep_allocation_pressure",
      before: /failure_message\(failure, message\);\s*status_error\(failure_code\(failure\.type\), message,/,
      after: "failure_message(failure, message);\n"
        + "        const std::string allocated(message);\n"
        + "        status_error(failure_code(failure.type), allocated.c_str(),",
    },
    {
      name: "receive-deadline", scenario: "deadline",
      before: "if (esp_timer_get_time() >= deadline_us) {",
      after: "if (((void)deadline_us, false)) {",
    },
    {
      name: "transaction-echo", scenario: "transaction",
      before: "mb_parse_response(io.adu, got, txn, unit, space, qty, out)",
      after: "mb_parse_response(io.adu, got, static_cast<uint16_t>((io.adu[0] << 8) | io.adu[1]), unit, space, qty, out)",
    },
    {
      name: "refresh-compressor-with-unrelated-reply", scenario: "compressor_witness",
      before: "logic::modbus_observation_age_s(s_compressor_ms, now_ms)",
      after: "logic::modbus_observation_age_s(s_last_reply_ms, now_ms)",
    },
    {
      name: "keep-copied-compressor-across-target-cutover", scenario: "compressor_witness",
      before: /if \(target_generation != s_target_generation\.load\(std::memory_order_acquire\)\) \{\s*live = false;\s*if \(activity\) \*activity = \{\};/,
      after: "if (target_generation != s_target_generation.load(std::memory_order_acquire)) { live = false;",
    },
    {
      name: "session-generation", scenario: "snapshot_generation",
      before: "cache_generation, target_generation,",
      after: "((void)cache_generation, s_link_generation), target_generation,",
    },
    {
      name: "profile-resolved-peer", scenario: "probe_resolved_peer_reconnect",
      before: "on_socket_open(host, port, unit, peer_ipv4, now_s)",
      after: "on_socket_open(host, port, unit, ((void)peer_ipv4, 0u), now_s)",
    },
    {
      name: "history-resolved-peer", scenario: "probe_resolved_peer_reconnect",
      before: /s_req_peer_ipv4\s*= ntohl\(addr\.sin_addr\.s_addr\);/,
      after: "s_req_peer_ipv4 = ((void)addr.sin_addr.s_addr, 0u);",
    },
    {
      name: "history-buckets-from-poll-end", scenario: "poll_history_reply_boundary",
      before: "first_history_bucket * bucket_us);",
      after: "now_bucket * bucket_us);",
    },
    {
      name: "history-tcp-handshake-only", scenario: "probe_resolved_peer_reconnect",
      before: /s_req_history_expected_generation = history_generation;\s*s_req_history_generation\s*= 0;/,
      after: "s_req_history_expected_generation = history_generation;\n"
        + "    s_req_history_generation = history_modbus_bind_peer(s_req_configured_target, s_req_peer_ipv4, history_generation);",
    },
    {
      name: "history-exception-only", scenario: "probe_resolved_peer_reconnect",
      before: /gates\.received_data &&\s*s_last_reply_ms >= 0/,
      after: "s_last_reply_ms >= 0",
    },
    {
      name: "history-cache-current-scope-instead-of-copied-scope", scenario: "probe_resolved_peer_reconnect",
      before: /if \(history_generation && live && cache_history_generation == history_modbus_generation\(\)\)\s*\*history_generation = cache_history_generation;/,
      after: "if (history_generation && live) *history_generation = ((void)cache_history_generation, history_modbus_generation());",
    },
    {
      name: "qualify-unsupported-flow-scale", scenario: "native_gateway_baseline",
      before: "cv.modbus_flow_scale_unverified = r.space == MbFunc::ReadInput && r.offset == 49;",
      after: "cv.modbus_flow_scale_unverified = false;",
    },
    {
      name: "publish-native-selection-as-quiet-activity", scenario: "native_gateway_baseline",
      before: /if \(r\.space == MbFunc::ReadHolding && r\.offset == 9 &&\s*r\.kind != def::HomeHubValueKind::Altherma4QuietSelection\)\s*return;/,
      after: "/* mutation: publish the unqualified activity row */",
    },
    {
      name: "target-profile", scenario: "profile_cutover",
      before: /^ {8}s_status\.profile\s*= ModbusProfile::Auto;$/m,
      after: "/* mutation: retain the previous target's profile */",
    },
    {
      name: "target-profile-basis", scenario: "profile_cutover",
      before: /^ {8}s_status\.profile_basis\s*= ModbusProfileBasis::Probing;$/m,
      after: "/* mutation: retain the previous target's profile basis */",
    },
    {
      name: "public-profile-authority", scenario: "reconfigure_generations",
      before: "return s_status.profile;",
      after: "return s_active_profile.load(std::memory_order_acquire);",
    },
    ...[{ name: "full", indent: 8 }, { name: "fast", indent: 12 }].map(({ name, indent }) => ({
      name: `${name}-status-target-generation`, scenario: "poll_cutover",
      before: new RegExp(`^ {${indent}}if \\(s_target_generation\\.load\\(std::memory_order_acquire\\) == cycle_target_generation\\) \\{\n {${indent + 4}}s_status\\.profile[^\n]+`, "m"),
      after: match => match.replace("if (s_target_generation.load(std::memory_order_acquire) == cycle_target_generation)", "if (true)"),
    })),
    {
      name: "zero-cache-time", scenario: "zero_cache_commit",
      before: "logic::modbus_observation_age_s(s_cache_commit_ms, esp_timer_get_time() / 1000)",
      after: "(s_cache_commit_ms == 0 ? UINT32_MAX : logic::modbus_observation_age_s(s_cache_commit_ms, esp_timer_get_time() / 1000))",
    },
    {
      name: "status-cache-age", scenario: "cache_count",
      before: "logic::modbus_observation_age_s(s_full_cache_status_ms, now_ms)",
      after: "0",
    },
    {
      name: "fallback-watchdog", scenario: "fallback_watchdog",
      before: "esp_task_wdt_reset();\n    const int sent = send(s_sock, req, n, 0);",
      after: "const int sent = send(s_sock, req, n, 0);",
    },
    ...["s_plant_gate_ms", "s_heating_mode_ms", "s_plant_outdoor_ms"].map(timestamp => ({
      name: `observation-age-${timestamp}`, scenario: "gate_age",
      before: `logic::modbus_observation_age_s(${timestamp}, now_ms) > MB_REPLY_MAX_AGE_S`,
      after: "logic::modbus_observation_age_s(s_last_reply_ms, now_ms) > MB_REPLY_MAX_AGE_S",
    })),
    ...["s_dhw_operation_ms", "s_plant_gate_ms"].map(timestamp => ({
      name: `values-activity-age-${timestamp}`, scenario: "compressor_witness",
      before: `logic::modbus_observation_age_s(${timestamp}, now_ms) <= MB_REPLY_MAX_AGE_S`,
      after: "logic::modbus_observation_age_s(s_last_reply_ms, now_ms) <= MB_REPLY_MAX_AGE_S",
    })),
    {
      name: "space-route-polarity", scenario: "space_route_values",
      before: /gates\.space_route_active\s*= raw == 0;/,
      after: "gates.space_route_active = raw == 1;",
    },
    {
      name: "space-route-unknown-word", scenario: "space_route_values",
      before: "r.offset == 37 && !mb_is_special(raw) && raw <= 1",
      after: "r.offset == 37 && !mb_is_special(raw)",
    },
    {
      name: "space-route-reply-age", scenario: "space_route_age",
      before: "logic::modbus_observation_age_s(s_space_route_ms, now_ms)",
      after: "logic::modbus_observation_age_s(s_last_reply_ms, now_ms)",
    },
    {
      name: "space-route-session-reset", scenario: "space_route_cutover",
      before: /^ {4}s_space_route_ms\s*= -1;$/m,
      after: "/* mutation: retain the preceding session's input37 response timestamp */",
    },
    ...[{ name: "full", indent: 8 }, { name: "fast", indent: 12 }].flatMap(({ name, indent }) => [
      {
        name: `${name}-space-route-known`, scenario: "space_route_values",
        before: new RegExp(`^ {${indent}}s_status\\.space_route_known\\s*= final_current_session && gates\\.space_route_known;`, "m"),
        after: "s_status.space_route_known = false;",
      },
      {
        name: `${name}-space-route-active`, scenario: "space_route_values",
        before: new RegExp(`^ {${indent}}s_status\\.space_route_active\\s*= final_current_session && gates\\.space_route_active;`, "m"),
        after: "s_status.space_route_active = false;",
      },
      {
        name: `${name}-space-route-session`, scenario: "space_route_cutover",
        before: new RegExp(`^ {${indent}}s_status\\.space_route_known\\s*= final_current_session && gates\\.space_route_known;`, "m"),
        after: "s_status.space_route_known = gates.space_route_known;",
      },
      {
        name: `${name}-space-route-time`, scenario: "space_route_age",
        before: new RegExp(`^ {${indent}}s_space_route_ms\\s*= final_current_session \\? gates\\.space_route_ms : -1;`, "m"),
        after: "s_space_route_ms = final_current_session ? esp_timer_get_time() / 1000 : -1;",
      },
      {
        name: `${name}-space-route-time-session`, scenario: "space_route_cutover",
        before: new RegExp(`^ {${indent}}s_space_route_ms\\s*= final_current_session \\? gates\\.space_route_ms : -1;`, "m"),
        after: "s_space_route_ms = gates.space_route_ms;",
      },
    ]),
    ...[{ member: "s_heating_mode_ms", local: "gates\\.heating_mode_ms" },
      { member: "s_plant_outdoor_ms", local: "plant_outdoor_ms" }].map(({ member, local }) => ({
      name: `completed-sweep-${member}`, scenario: "gate_age",
      before: new RegExp(`^ {8}${member}\\s*= final_current_session \\? ${local} : -1;`, "m"),
      after: `${member} = final_current_session ? cache_commit_ms : -1;`,
    })),
    {
      name: "discovery-attempt-budget", scenario: "discovery_budget",
      before: /const int\s+lookup_ms = remaining_ms > 2000 \? 2000 : static_cast<int>\(remaining_ms\);/,
      after: "const int lookup_ms = ((void)remaining_ms, 2000);",
    },
  ];
  for (const mutation of mutations) {
    const mutated = mutateOnce(mutation.before, mutation.after, mutation.name);
    const mutant = compile(mutated, mutation.name);
    const result = execute(mutant, [mutation.scenario], 10000);
    assert.equal(result.status, 1, `${mutation.name}: behavioral oracle must reject the mutation\n${result.stdout}${result.stderr}`);
    assert.match(result.stderr, new RegExp(`^FAIL ${mutation.scenario}:`, "m"),
      `${mutation.name}: only its specific assertion failure counts`);
    console.log(`negative control ${mutation.name}: rejected by ${mutation.scenario}`);
  }
  console.log(`production Modbus runtime: ${baselineCount} cases, ${mutations.length} negative controls; source sha256=${sourceHash}`);
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}
