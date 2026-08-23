#!/usr/bin/env node
// Prove the production OTA source contract still detects removal of its load-bearing boundaries.
// Every mutation runs in an isolated throwaway tree; hardware is never contacted.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const contract = path.join(root, "test/test_production_ota_gate_contract.mjs");
const files = [
  "scripts/production-ota-gate.py",
  "tools/agent-hooks/agent_hook.py",
  "main/logic/health_gate.hpp",
  "main/ota_update.cpp",
  "main/http_ota.cpp",
  "main/mqtt_ha.cpp",
  "main/logic/ota_quiesce.hpp",
  ".github/workflows/build.yml",
];
const pristine = new Map(files.map(rel => [rel, fs.readFileSync(path.join(root, rel), "utf8")]));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "daikin-production-ota-contract-"));

const restore = () => {
  for (const [rel, contents] of pristine) {
    const target = path.join(tmp, rel);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, contents);
  }
};
const replaceOnce = (rel, before, after) => {
  const target = path.join(tmp, rel);
  const old = fs.readFileSync(target, "utf8");
  const changed = old.replace(before, after);
  assert.notEqual(changed, old, `mutation no longer reaches ${rel}: ${String(before)}`);
  fs.writeFileSync(target, changed);
};
const run = () => spawnSync(process.execPath, [contract], {
  cwd: root,
  env: { ...process.env, PRODUCTION_OTA_CONTRACT_ROOT: tmp },
  encoding: "utf8",
});

try {
  restore();
  const baseline = run();
  if (baseline.status !== 0) {
    process.stderr.write(baseline.stdout + baseline.stderr);
    throw new Error("production OTA contract is already red on the unmodified tree");
  }

  const cases = [
    ["the test-board role is redirected to production", () =>
      replaceOnce("scripts/production-ota-gate.py", 'BENCH_ROLE = "bench"',
        'BENCH_ROLE = "production"')],
    ["the explicit ordinary bench-install action is removed", () =>
      replaceOnce("scripts/production-ota-gate.py",
        'parser.add_argument("--install-bench", action="store_true")',
        'parser.add_argument("--install-bench-bypassed", action="store_true")')],
    ["the ordinary bench current-version lease is bypassed", () =>
      replaceOnce("scripts/production-ota-gate.py",
        "if current_version == target_version:", "if False:")],
    ["the ordinary bench update write is bypassed", () =>
      replaceOnce("scripts/production-ota-gate.py",
        "update_generation = post_update_once(", "update_generation = update_write_bypassed(")],
    ["the ordinary bench verifier evidence is bypassed", () =>
      replaceOnce("scripts/production-ota-gate.py",
        'require_ota_transfer_evidence(host, transfer, phase="bench target")',
        "pass  # bench verifier evidence bypassed")],
    ["the ordinary bench rollback-health dwell is bypassed", () =>
      replaceOnce("scripts/production-ota-gate.py",
        "health_window = wait_for_bench_health_window(",
        "health_window = bypass_bench_health_window(")],
    ["the ordinary bench pressure stage is bypassed", () =>
      replaceOnce("scripts/production-ota-gate.py",
        "stress = stress_board(", "stress = bypass_bench_stress(")],
    ["the ordinary bench action falls through into release and production", () =>
      replaceOnce("scripts/production-ota-gate.py",
        '        print(json.dumps(result, indent=2, sort_keys=True))\n        return 0\n\n    release_manifest',
        '        print(json.dumps(result, indent=2, sort_keys=True))\n        bench_return_bypassed()\n\n    release_manifest')],
    ["the runtime accepts abbreviated noncanonical gate options", () =>
      replaceOnce("scripts/production-ota-gate.py",
        "ArgumentParser(description=__doc__, allow_abbrev=False)",
        "ArgumentParser(description=__doc__)")],
    ["the pressure window is shortened", () =>
      replaceOnce("scripts/production-ota-gate.py", "STRESS_SECONDS = 180", "STRESS_SECONDS = 60")],
    ["the manifest observer is shorter than firmware's bounded check path", () =>
      replaceOnce("scripts/production-ota-gate.py", "OTA_CHECK_TIMEOUT_S = 120",
        "OTA_CHECK_TIMEOUT_S = 30")],
    ["the sole-write observer is shorter than firmware's bounded install path", () =>
      replaceOnce("scripts/production-ota-gate.py", "OTA_TIMEOUT_S = 480", "OTA_TIMEOUT_S = 180")],
    ["publisher quiescence no longer outlives the authoritative observer", () =>
      replaceOnce("main/logic/ota_quiesce.hpp", "OTA_QUIESCE_MAX_CYCLES = 600",
        "OTA_QUIESCE_MAX_CYCLES = 480")],
    ["the official bench release feed is replaced", () =>
      replaceOnce("scripts/production-ota-gate.py",
        'OFFICIAL_RELEASE_MANIFEST_URL = "https://0bu.github.io/daikin-altherma-esp32/manifest.json"',
        'OFFICIAL_RELEASE_MANIFEST_URL = "https://example.test/manifest.json"')],
    ["the full bench binary exercise is bypassed", () =>
      replaceOnce("scripts/production-ota-gate.py",
        "full_download_evidence = exercise_bench_full_download(",
        "full_download_evidence = bench_manifest_only_bypass(")],
    ["the freshly installed target skips its health window", () =>
      replaceOnce("scripts/production-ota-gate.py",
        "target_health_window = wait_for_bench_health_window(",
        "target_health_window = bypass_target_health_window(")],
    ["the target is denied its explicit bench downgrade", () =>
      replaceOnce("scripts/production-ota-gate.py",
        'expected_channel="release", allow_downgrade=True',
        'expected_channel="release", allow_downgrade=False')],
    ["the bench is not restored to the dev channel", () =>
      replaceOnce("scripts/production-ota-gate.py",
        'set_update_channel(host, "dev")',
        'set_update_channel(host, "release")')],
    ["the legacy bench restore trusts a stale idle offer", () =>
      replaceOnce("scripts/production-ota-gate.py",
        "LEGACY_OFFER_STABLE_SECONDS = 3.0",
        "LEGACY_OFFER_STABLE_SECONDS = 0.0")],
    ["the release health-window wait is bypassed", () =>
      replaceOnce("scripts/production-ota-gate.py",
        "release_health_window = wait_for_bench_health_window(",
        "release_health_window = bypass_release_health_window(")],
    ["a gate-only change no longer republishes an exact-source artifact", () =>
      replaceOnce(".github/workflows/build.yml", "|production-ota-gate", "")],
    ["full-transfer status busy refusal is no longer required", () =>
      replaceOnce("scripts/production-ota-gate.py",
        'for key in ("status_busy_503", "values_busy_503", "diag_ok", "ota_status_ok"):',
        'for key in ("values_busy_503", "diag_ok", "ota_status_ok"):')],
    ["full-transfer heap telemetry is no longer required", () =>
      replaceOnce("scripts/production-ota-gate.py",
        'fail(f"{host} target OTA did not expose sampled operation-local heap minima")',
        'pass  # heap telemetry bypassed')],
    ["offer polling ignores a replaced operation generation", () =>
      replaceOnce("scripts/production-ota-gate.py", "generation != expected_generation",
        "False")],
    ["offer polling ignores the authoritative busy claim", () =>
      replaceOnce("scripts/production-ota-gate.py", 'if status.get("busy") is True:',
        "if False:")],
    ["offer polling ignores the checked application SHA", () =>
      replaceOnce("scripts/production-ota-gate.py",
        'status.get("available_sha256") != expected_app_sha256',
        "False")],
    ["the sole update POST omits the checked application SHA", () =>
      replaceOnce("scripts/production-ota-gate.py", '"sha256": expected_app_sha256',
        '"ignored": expected_app_sha256')],
    ["the update may skip over an intervening accepted operation", () =>
      replaceOnce("scripts/production-ota-gate.py",
        "expected_generation = 1 if check_generation == 0xFFFFFFFF else check_generation + 1",
        "expected_generation = check_generation")],
    ["legacy firmware is silently allowed into the one-write path", () =>
      replaceOnce("scripts/production-ota-gate.py", "no update POST was sent",
        "legacy update may continue")],
    ["a rejected firmware operation is reported as HTTP success", () =>
      replaceOnce("main/http_ota.cpp", 'httpd_resp_set_status(req, "503 Service Unavailable");',
        'httpd_resp_set_status(req, "200 OK");')],
    ["the signature verifier is bypassed", () =>
      replaceOnce("scripts/production-ota-gate.py", 'ROOT / "scripts/require-signed.sh"',
        'ROOT / "scripts/signature-check-bypassed.sh"')],
    ["the official dev artifact skips the Range preflight", () =>
      replaceOnce("scripts/production-ota-gate.py",
        "verify_http_range_support(app_url, binary)",
        "verify_http_range_support_bypassed(app_url, binary)")],
    ["the official release artifact skips the Range preflight", () =>
      replaceOnce("scripts/production-ota-gate.py",
        "verify_http_range_support(release_url, release_binary)",
        "verify_http_range_support_bypassed(release_url, release_binary)")],
    ["the Range preflight accepts a full 200 response", () =>
      replaceOnce("scripts/production-ota-gate.py", "response.status != 206", "False")],
    ["the Range preflight ignores returned artifact bytes", () =>
      replaceOnce("scripts/production-ota-gate.py", "body != binary[:1]", "False")],
    ["bench pressure workers leak after an OTA failure", () =>
      replaceOnce("scripts/production-ota-gate.py", "    finally:\n        stop.set()",
        "    except Exception:\n        raise\n    else:\n        stop.set()")],
    ["the complete source-contract runner is skipped", () =>
      replaceOnce("scripts/production-ota-gate.py", 'ROOT / "scripts/run-contract-tests.sh"',
        'ROOT / "scripts/run-contract-smoke.sh"')],
    ["real OTA TLS is removed from the pressure window", () =>
      replaceOnce("scripts/production-ota-gate.py", 'f"/ota/check?ms={int(time.time() * 1000)}"',
        '"/ota/status"')],
    ["an existing MQTT outage is hidden by the OTA pause allowance", () =>
      replaceOnce("scripts/production-ota-gate.py",
        'if not started.get("mqtt", {}).get("connected"):',
        "if False:")],
    ["the intentional OTA MQTT pause is counted as an outage", () =>
      replaceOnce("scripts/production-ota-gate.py",
        'ota_expected=ota_expected_before or mqtt_recovery_expected.is_set()',
        'ota_expected=False')],
    ["an in-flight OTA status sample loses its request-start pause lease", () =>
      replaceOnce("scripts/production-ota-gate.py",
        'ota_expected=ota_expected_before or mqtt_recovery_expected.is_set()',
        'ota_expected=mqtt_recovery_expected.is_set()')],
    ["the OTA pause lease is captured only after the status request", () =>
      replaceOnce("scripts/production-ota-gate.py",
        /([ \t]*)ota_expected_before = mqtt_recovery_expected\.is_set\(\)\n\1status = request_json\(host, "\/status"\)/,
        '$1status = request_json(host, "/status")\n$1ota_expected_before = mqtt_recovery_expected.is_set()')],
    ["the intentional weather MQTT pause is counted as an outage", () =>
      replaceOnce("scripts/production-ota-gate.py",
        'weather_evidence = weather_fetching or weather_successes > self.weather_successes_seen',
        'weather_evidence = False')],
    ["the completed weather fetch loses its MQTT resume allowance", () =>
      replaceOnce("scripts/production-ota-gate.py",
        'weather_successes > self.weather_successes_seen',
        'False')],
    ["the weather MQTT allowance survives a successful reconnect", () =>
      replaceOnce("scripts/production-ota-gate.py",
        'self.weather_expected = False',
        'self.weather_expected = True')],
    ["fresh weather evidence is closed by an older connected MQTT field", () =>
      replaceOnce("scripts/production-ota-gate.py",
        'if not weather_evidence or weather_was_expected or pending_was_observed:',
        'if True:')],
    ["weather MQTT recovery is no longer time bounded", () =>
      replaceOnce("scripts/production-ota-gate.py",
        'now > self.weather_deadline',
        'False')],
    ["a mixed pre-weather status sample cannot await the following weather edge", () =>
      replaceOnce("scripts/production-ota-gate.py",
        /(if weather_evidence:[\s\S]{0,400}?)self\.pending_disconnects = 0/,
        '$1self.pending_disconnects += 0')],
    ["a mixed status sample can wait forever after reconnect", () =>
      replaceOnce("scripts/production-ota-gate.py",
        'if self.pending_disconnects and now > self.pending_deadline:',
        'if False:')],
    ["late weather evidence forgives an already expired MQTT gap", () =>
      replaceOnce("scripts/production-ota-gate.py",
        'if self.pending_disconnects and now > self.pending_deadline:',
        'if self.pending_disconnects and now > self.pending_deadline and not weather_evidence:')],
    ["a pending unexplained disconnect is discarded when stress ends", () =>
      replaceOnce("scripts/production-ota-gate.py",
        'disconnected += mqtt_recovery.finish()',
        'pass  # pending disconnect bypassed')],
    ["MQTT recovery after OTA TLS is no longer observed", () =>
      replaceOnce("scripts/production-ota-gate.py",
        'if mqtt_recovery_status.get("mqtt", {}).get("connected"):',
        "if True:")],
    ["the reboot waiter polls full status while OTA still owns TLS", () =>
      replaceOnce("scripts/production-ota-gate.py",
        'if ota.get("state") not in ("checking", "updating", "done"):',
        'if True:')],
    ["the target verifier completion is no longer observed", () =>
      replaceOnce("scripts/production-ota-gate.py",
        'if target_transfer.get("saw_done") is not True:',
        'if False:')],
    ["the final contiguous-block floor is reduced", () =>
      replaceOnce("scripts/production-ota-gate.py", "MIN_FINAL_LARGEST_BLOCK = 16 * 1024",
        "MIN_FINAL_LARGEST_BLOCK = 8 * 1024")],
    ["an unwired bench is subjected to the production X10A timeout limit", () =>
      replaceOnce("scripts/production-ota-gate.py", "return require_x10a and final[\"timeout_err\"]",
        "return True and final[\"timeout_err\"]")],
    ["the production canary disables its X10A requirement", () =>
      replaceOnce("scripts/production-ota-gate.py",
        /(production_evidence = stress_board\([\s\S]{0,200}?)require_x10a=True,/,
        "$1require_x10a=False,")],
    ["the production canary disables its weather TLS requirement", () =>
      replaceOnce("scripts/production-ota-gate.py",
        /(production_evidence = stress_board\([\s\S]{0,200}?)require_weather=True,/,
        "$1require_weather=False,")],
    ["the no-release result is falsified", () =>
      replaceOnce("scripts/production-ota-gate.py", '"release_created": False',
        '"release_created": True')],
    ["raw OTA writes are no longer routed through the gate", () =>
      replaceOnce("tools/agent-hooks/agent_hook.py", "direct OTA writes are forbidden; run scripts/production-ota-gate.py",
        "direct OTA writes are allowed")],
    ["the hook no longer pins the literal bench role", () =>
      replaceOnce("tools/agent-hooks/agent_hook.py",
        'exact_values["--confirm-bench"] = "bench"',
        'exact_values["--confirm-bench"] = "production"')],
    ["the hook accepts a symlink alias as canonical", () =>
      replaceOnce("tools/agent-hooks/agent_hook.py",
        "Path(os.path.abspath(executable)) != canonical",
        "executable.resolve(strict=False) != canonical")],
    ["the raw OTA guard drops HTTPie and xh", () =>
      replaceOnce("tools/agent-hooks/agent_hook.py",
        'executable in {"http", "xh"}', 'executable == "ignored-http-client"')],
    ["the raw OTA guard drops curl equals-form data options", () =>
      replaceOnce("tools/agent-hooks/agent_hook.py",
        'argument.startswith(("--data", "--form", "--json=", "--upload-file="))',
        'argument.startswith(("--ignored-data", "--form", "--json=", "--upload-file="))')],
    ["the raw OTA guard drops HTTPie inferred body posts", () =>
      replaceOnce("tools/agent-hooks/agent_hook.py",
        '":=" in argument or', 'False or')],
    ["the raw OTA guard drops PowerShell posts", () =>
      replaceOnce("tools/agent-hooks/agent_hook.py",
        '"-methodpost",',
        '"-ignored-method-post",')],
    ["the raw OTA guard drops HTTPie raw bodies", () =>
      replaceOnce("tools/agent-hooks/agent_hook.py",
        'argument == "--raw" or argument.startswith("--raw=")',
        'argument == "--ignored-raw" or argument.startswith("--ignored-raw=")')],
    ["shell-built OTA update routes bypass the raw guard", () =>
      replaceOnce("tools/agent-hooks/agent_hook.py",
        're.search(r"https?://[^\'\\";&|]*[$`][\\s\\S]{0,160}/update", decoded, re.IGNORECASE)',
        're.search(r"ignored-dynamic-route", decoded, re.IGNORECASE)')],
    ["a Git shell alias can wrap the canonical OTA gate", () =>
      replaceOnce("tools/agent-hooks/agent_hook.py",
        'args = tokens[1:]\n        if executable not in',
        'args = tokens[1:]\n        if executable == "git":\n            continue\n        if executable not in')],
    ["a renamed symlink can impersonate the canonical OTA gate", () =>
      replaceOnce("tools/agent-hooks/agent_hook.py",
        "os.path.samefile(lexical, canonical)", "False")],
    ["a renamed exact copy can impersonate the canonical OTA gate", () =>
      replaceOnce("tools/agent-hooks/agent_hook.py",
        "filecmp.cmp(lexical, canonical, shallow=False)", "False")],
    ["an env split-string wrapper can invoke the canonical OTA gate", () =>
      replaceOnce("tools/agent-hooks/agent_hook.py",
        "results.extend(shell_token_sets(resolved_segment[index + 1], depth + 1))",
        "results.extend([])")],
    ["wrapped network clients are no longer inspected", () =>
      replaceOnce("tools/agent-hooks/agent_hook.py",
        "for client_index, token in enumerate(tokens):",
        "for client_index, token in enumerate(tokens[:1]):")],
    ["dynamic OTA client methods are accepted", () =>
      replaceOnce("tools/agent-hooks/agent_hook.py",
        'dynamic_client_arguments = any(re.search(r"[$`]", argument) for argument in raw_arguments)',
        "dynamic_client_arguments = False")],
    ["clustered curl short options bypass the OTA method parser", () =>
      replaceOnce("tools/agent-hooks/agent_hook.py",
        "method, cluster_get, cluster_body, cluster_ambiguous = curl_short_option_effects(",
        "method, cluster_get, cluster_body, cluster_ambiguous = ignored_curl_short_options(")],
    ["curl next transfers can hide an earlier OTA write", () =>
      replaceOnce("tools/agent-hooks/agent_hook.py",
        'if "--next" in arguments:', "if False:")],
    ["curl GET flags can mask a dynamic explicit POST", () =>
      replaceOnce("tools/agent-hooks/agent_hook.py",
        `not explicit_method and (
                        has_get_flag or any(argument in {"-g", "--get"} for argument in arguments)
                    )`,
        `explicit_method != "post" and (
                        has_get_flag or any(argument in {"-g", "--get"} for argument in arguments)
                    )`)],
    ["an earlier wget GET can mask a later dynamic method", () =>
      replaceOnce("tools/agent-hooks/agent_hook.py",
        'literal_safe_method = effective_method in {"get", "head"}',
        'literal_safe_method = any(argument in {"--method=get", "--method=head"} for argument in arguments)')],
    ["HTTPie stdin bodies are no longer recognized", () =>
      replaceOnce("tools/agent-hooks/agent_hook.py",
        "shell_client_receives_stdin(decoded, executable)", "False")],
    ["raw HTTP request lines bypass the OTA guard", () =>
      replaceOnce("tools/agent-hooks/agent_hook.py",
        'if re.match(r"^\\s*post\\s+/", expanded, re.IGNORECASE):',
        "if False:")],
    ["quote-normalized raw HTTP methods bypass the OTA guard", () =>
      replaceOnce("tools/agent-hooks/agent_hook.py",
        "raw_tokens = shell_syntax_tokens(decoded)", "raw_tokens = []")],
    ["brace-expanded raw HTTP methods bypass the OTA guard", () =>
      replaceOnce("tools/agent-hooks/agent_hook.py",
        "for expanded in expand_static_braces(argument):", "for expanded in [argument]:")],
    ["dynamic raw HTTP methods bypass the OTA guard", () =>
      replaceOnce("tools/agent-hooks/agent_hook.py",
        'return re.search(r"[$`]", method.group(1)) is not None if method else False',
        "return False")],
    ["printf can assemble an OTA request line across arguments", () =>
      replaceOnce("tools/agent-hooks/agent_hook.py",
        "or has_printf and (", "or False and (")],
    ["shell dev-tcp can carry a raw OTA request", () =>
      replaceOnce("tools/agent-hooks/agent_hook.py",
        're.search(r"/dev/(?:tcp|udp)/", decoded, re.IGNORECASE)',
        're.search(r"ignored-dev-tcp", decoded, re.IGNORECASE)')],
    ["brace-expanded client methods bypass the OTA guard", () =>
      replaceOnce("tools/agent-hooks/agent_hook.py",
        "for expanded in expand_static_braces(argument.lower()):",
        "for expanded in [argument.lower()]:")],
    ["curl URL globs can reach the OTA route", () =>
      replaceOnce("tools/agent-hooks/agent_hook.py",
        /(def possible_ota_update_route[\s\S]{0,1200}?)for expanded in expand_static_braces\(token\):/,
        "$1for expanded in [token]:")],
    ["shell globs can execute the canonical OTA gate", () =>
      replaceOnce("tools/agent-hooks/agent_hook.py",
        'token_may_name_command(token, "production-ota-gate.py")', "False")],
    ["dynamic script paths can execute the canonical OTA gate", () =>
      replaceOnce("tools/agent-hooks/agent_hook.py",
        '("production-ota-" in compact and "gate.py" in compact)', "False")],
    ["split dynamic paths can execute a gate carrying canonical artifact options", () =>
      replaceOnce("tools/agent-hooks/agent_hook.py",
        '"--manifest-url", "--expected-source-sha", "--expected-version",',
        '"--ignored-manifest", "--ignored-source", "--ignored-version",')],
    ["urllib inferred POST bodies bypass the OTA guard", () =>
      replaceOnce("tools/agent-hooks/agent_hook.py",
        '"urlopen(" in compact and "data=" in compact', "False")],
    ["attached env split strings can wrap a renamed gate", () =>
      replaceOnce("tools/agent-hooks/agent_hook.py",
        'token.startswith("-S") and token != "-S"', "False")],
    ["equals-form env split strings can wrap a renamed gate", () =>
      replaceOnce("tools/agent-hooks/agent_hook.py",
        'token.startswith("--split-string=")', "False")],
    ["Git helper strings can execute a renamed gate alias", () =>
      replaceOnce("tools/agent-hooks/agent_hook.py",
        "nested_tokens.extend(shell_token_sets(nested))", "nested_tokens.extend([])")],
    ["a merely connected image can bypass allocation failure evidence", () =>
      replaceOnce("main/logic/health_gate.hpp", "!service.allocation_failures && x10a_ready",
        "x10a_ready")],
    ["an accepted X10A publish no longer raises proof", () =>
      replaceOnce("main/mqtt_ha.cpp", "s_x10a_publish_proven.store(true, std::memory_order_release)",
        "s_x10a_publish_proven.store(false, std::memory_order_release)")],
    ["a failed health cap no longer forces rollback", () =>
      replaceOnce("main/ota_update.cpp",
        /(HealthVerdict::GiveUp[\s\S]{0,500}?)esp_restart\(\);/,
        "$1ota_rollback_restart_bypassed();")],
  ];

  let caught = 0;
  for (const [name, mutate] of cases) {
    restore();
    mutate();
    const result = run();
    if (result.status === 0) throw new Error(`production OTA contract missed mutation: ${name}`);
    caught++;
    console.log(`production OTA selftest: detected — ${name}`);
  }
  console.log(`production OTA selftest: all ${caught} seeded regressions caught`);
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
