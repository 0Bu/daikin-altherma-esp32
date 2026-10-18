// Exercise the real pressure evaluator and durable receipt at its final-sample boundary.
// Synthetic counts and clock replace pressure workers; this is no network or hardware proof.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(process.env.PRODUCTION_OTA_CONTRACT_ROOT ||
  path.join(path.dirname(fileURLToPath(import.meta.url)), ".."));
const probe = String.raw`
import ast, contextlib, copy, io, json, pathlib, runpy, shutil, sys
from unittest.mock import patch

gate = runpy.run_path(sys.argv[1], run_name="pressure_receipt_probe")
ns = gate["stress_board"].__globals__
checks = 0
def check(condition, name):
    global checks
    checks += 1
    if not condition:
        raise AssertionError(name)

tree = ast.parse(pathlib.Path(sys.argv[1]).read_text())
function = next(node for node in tree.body
                if isinstance(node, ast.FunctionDef) and node.name == "stress_board")
phases = {"bench_pressure_sampled", "production_pressure_sampled"}
recovery_phases = {"bench_recovery_sampled", "production_recovery_sampled"}
def sampled_checkpoint(node, selected=phases):
    return isinstance(node, ast.Expr) and isinstance(node.value, ast.Call) and \
        isinstance(node.value.func, ast.Name) and node.value.func.id == "journal_checkpoint" and \
        any(isinstance(value, ast.Constant) and value.value in selected
            for value in ast.walk(node.value))
checkpoint = [node for node in ast.walk(function) if sampled_checkpoint(node)]
check(len(checkpoint) == 1, "PRESSURE_HAS_ONE_FINAL_SAMPLE_CHECKPOINT")
counter_line = next(node.lineno for node in function.body if isinstance(node, ast.Assign) and
                    any(isinstance(target, ast.Name) and target.id == "final"
                        for target in node.targets))
errors_line = next(node.lineno for node in function.body if isinstance(node, ast.If) and
                   isinstance(node.test, ast.Name) and node.test.id == "errors")
check(counter_line < checkpoint[0].lineno < errors_line,
      "PRESSURE_FINAL_SAMPLE_PRECEDES_REJECTION_CHECKS")
recovery = [node for node in ast.walk(function) if sampled_checkpoint(node, recovery_phases)]
check(len(recovery) == 1, "PRESSURE_HAS_ONE_RECOVERY_SAMPLE_CHECKPOINT")
if sys.argv[2].startswith("omit-"):
    omitted_phases = recovery_phases if sys.argv[2] == "omit-recovery" else phases
    class OmitCheckpoint(ast.NodeTransformer):
        def visit_Expr(self, node):
            return ast.copy_location(ast.Pass(), node) if sampled_checkpoint(node, omitted_phases) else node
    mutant = OmitCheckpoint().visit(copy.deepcopy(function))
    module = ast.Module(body=[ast.ImportFrom(module="__future__", level=0,
        names=[ast.alias(name="annotations")]), mutant], type_ignores=[])
    exec(compile(ast.fix_missing_locations(module), sys.argv[1], "exec"), ns)

version, elf, sha = "2.0.0-dev.2", "abcdef123", "a" * 64
mac = "02:00:00:00:00:01"
private = "private-pressure-fixture"
sample_counts = {"status": 300, "values": 120, "diag": 10}
busy_counts = {"status": 1, "values": 1}
cases = 0
for pending, weather in ((True, False), (False, False), (True, True), (False, True)):
    if sys.argv[2] == "omit-recovery" and not weather: continue
    role = "test_board" if pending else "production"
    host = "bench.invalid" if pending else "production.invalid"
    initial_phase = "bench_cold_pressure_started" if pending else "production_pressure_started"
    sampled_phase = "bench_pressure_sampled" if pending else "production_pressure_sampled"
    recovery_phase = "bench_recovery_sampled" if pending else "production_recovery_sampled"
    final_phase = recovery_phase if weather else sampled_phase
    final_uptime = 194 if weather else 187
    for scenario in ("low free", "low block", "boundary", "counter rejection"):
        virtual, status_calls, joins, starts = [0.0], [], [], []
        routes, initial_samples, pressure_samples, refreshes = [], [], [], []
        result, rejection = None, None
        free = ns["MIN_FINAL_FREE_HEAP"] + 1234
        largest = ns["MIN_FINAL_LARGEST_BLOCK"] + 5678
        if scenario == "low free": free = ns["MIN_FINAL_FREE_HEAP"] - 1
        if scenario == "low block": largest = ns["MIN_FINAL_LARGEST_BLOCK"] - 1
        if scenario == "boundary":
            free, largest = ns["MIN_FINAL_FREE_HEAP"], ns["MIN_FINAL_LARGEST_BLOCK"]
        def board(uptime, final=False, refresh=0):
            return {"version": version, "app_elf_sha256": elf, "uptime_s": uptime,
                "wifi": {"mac": mac, "connected": True, "rolled_back": False, "ssid": private},
                "mqtt": {"connected": True, "broker": private},
                "weather_forecast": {"configured": True, "fetching": False,
                    "latitude": private, "longitude": private, "successes": int(refresh == 2),
                    "errors": 0, "state": "ok" if refresh == 2 else "waiting",
                    "reason": "" if refresh == 2 else "heap_headroom",
                    "fetched_at": 1700000000 if refresh == 2 else 0,
                    "refresh_requested_token": refresh, "refresh_started_token": refresh,
                    "refresh_completed_token": refresh,
                    "refresh_success_token": 2 if refresh == 2 else 0},
                "sys": {"safe_mode": False, "heap_restarts": 0, "poll_skipped": 0,
                    "mqtt_skipped": int(final and scenario == "counter rejection"),
                    "free_heap": free if final else ns["POST_STRESS_MIN_FREE_HEAP"] + 8192,
                    "max_alloc": largest if final else ns["POST_STRESS_MIN_LARGEST_BLOCK"] + 8192},
                "hp": {"connected": True, "values": 129, "crc_err": 2,
                       "timeout_err": 5 if final and weather else 4 if uptime >= 187 else 3}}
        exact_final = board(final_uptime, True, 2 if weather else 0)
        exact_pressure = board(187, refresh=1 if weather else 0)
        before = ns["board_counters"](board(7))
        after = ns["board_counters"](exact_final)
        def status(endpoint, **kwargs):
            check(endpoint == host, "PRESSURE_PINNED_STATUS_ENDPOINT")
            status_calls.append(kwargs)
            check(len(status_calls) <= (8 if weather else 3), "PRESSURE_NO_EXTRA_STATUS_RETRY")
            if weather:
                index = len(status_calls) - 1
                if index == 7: return exact_final
                return board((7, 8, 9, 187, 188, 189, 190)[index],
                             refresh=0 if index == 0 else 1 if index < 6 else 2)
            return board(7) if len(status_calls) == 1 else \
                board(8) if len(status_calls) == 2 else exact_final
        def request_json(endpoint, route, **kwargs):
            if route == "/set_weather":
                check(weather and endpoint == host and kwargs.get("method") == "POST" and
                      kwargs.get("payload") == {"latitude": private, "longitude": private, "refresh": True},
                      "PRESSURE_RECOVERY_REFRESH_IS_NONPERSISTENT_FIXTURE_ONLY")
                refreshes.append(len(refreshes) + 1)
                routes.append(route)
                return {"ok": True, "reboot": False, "saved": False, "refresh_requested": True,
                        "refresh_token": refreshes[-1]}
            check(endpoint == host and kwargs.get("method", "GET") == "GET",
                  "PRESSURE_NO_OTA_OR_CONFIGURATION_WRITE")
            routes.append(route)
            if route.startswith("/ota/check?"):
                return {"ok": True, "generation": 7}
            check(route == "/ota/status", "PRESSURE_ONLY_EXPECTED_OTA_READS")
            if pending and len(routes) == 1:
                return {"image_state": "pending_verify", "rollback_pending": True,
                        "private": private}
            return {"generation": 7, "busy": False, "state": "idle", "available": version,
                    "available_sha256": sha, "available_channel": "dev"}
        class Worker:
            def __init__(self, **kwargs): self.target = kwargs["target"]
            def start(self): starts.append(self.target.__name__)
            def join(self, timeout):
                joins.append(timeout)
                virtual[0] = float(ns["STRESS_SECONDS"])
            def is_alive(self): return False
        def forbidden(*args, **kwargs):
            raise AssertionError("PRESSURE_FIXTURE_ATTEMPTED_UNEXPECTED_IO_OR_PROBATION")
        original_checkpoint = ns["journal_checkpoint"]
        def checkpoint(phase, **updates):
            if phase == initial_phase:
                stress = updates[role]["stress"]
                stress["samples"].update(sample_counts)
                stress["tls_busy_503"].update(busy_counts)
                initial_samples.append(copy.deepcopy(stress))
            if phase == sampled_phase:
                pressure_samples.append(copy.deepcopy(updates[role]["stress"]))
            original_checkpoint(phase, **updates)
        output = io.StringIO()
        with contextlib.redirect_stdout(output), contextlib.redirect_stderr(output):
            journal = ns["GateJournal"]()
        try:
            replacements = {"ACTIVE_JOURNAL": journal, "resolve_http_endpoint": lambda value: value,
                "request_status_deadline": status, "request_json_deadline": request_json,
                "journal_checkpoint": checkpoint, "request_values_deadline": forbidden,
                "request_diag_deadline": forbidden, "post_update_once": forbidden,
                "confirm_bench_probation": forbidden, "confirm_production_probation": forbidden}
            with patch.dict(ns, replacements), \
                patch.object(ns["threading"], "Thread", Worker), \
                patch.object(ns["time"], "monotonic", lambda: virtual[0]), \
                patch.object(ns["time"], "time", lambda: 1700000000.0), \
                patch.object(ns["time"], "sleep", lambda seconds: virtual.__setitem__(0, virtual[0] + seconds)), \
                patch.object(ns["socket"], "create_connection", forbidden), \
                patch.object(ns["socket"], "getaddrinfo", forbidden):
                try:
                    result = ns["stress_board"](host=host, mac=mac, version=version, elf=elf,
                        require_x10a=not pending, require_weather=weather, expected_app_sha256=sha,
                        expected_channel="dev", require_pending_image=pending)
                except ns["GateError"] as error:
                    rejection = str(error)
                    # Model the caller's blocked receipt, without replacing stress_board's rejection.
                    journal.checkpoint("blocked", outcome="blocked", error=rejection + private)
            document = json.loads(journal.path.read_text())
            stress = document["receipt"][role].get("stress", {})
            check(final_phase in document["phases"] and "counters_after" in stress,
                  "PRESSURE_RECOVERY_SAMPLE_PERSISTED_BEFORE_REJECTION" if weather else
                  "PRESSURE_FINAL_SAMPLE_PERSISTED_BEFORE_REJECTION")
            check(stress["free_heap"] == free and stress["largest_block"] == largest and
                  stress["counters_after"] == after, "PRESSURE_EXACT_FINAL_METRICS_RETAINED")
            check(len(initial_samples) == 1 and stress["samples"] == sample_counts and
                  stress["tls_busy_503"] == busy_counts and stress["counters_before"] == before and
                  stress["probation_before"] == initial_samples[0]["probation_before"],
                  "PRESSURE_ORIGINAL_START_WITNESSES_RETAINED")
            check(stress["uptime"][0] == 7 and stress["uptime"][-1] == final_uptime and
                  all(a <= b for a, b in zip(stress["uptime"], stress["uptime"][1:])),
                  "PRESSURE_FINAL_UPTIME_RETAINED")
            check((stress["probation_before"] is not None) == pending,
                  "PRESSURE_PENDING_WITNESS_MATCHES_ROLE")
            if weather:
                original = {key: pressure_samples[0][key] for key in
                            ("free_heap", "largest_block", "counters_after", "uptime")}
                check(stress.get("pressure_sample") == original and
                      original["free_heap"] == exact_pressure["sys"]["free_heap"] and
                      original["largest_block"] == exact_pressure["sys"]["max_alloc"] and
                      original["counters_after"] == ns["board_counters"](exact_pressure) and
                      original["uptime"][0] == 7 and original["uptime"][-1] == 187 and
                      document["phases"].index(sampled_phase) < document["phases"].index(recovery_phase),
                      "PRESSURE_ORIGINAL_SAMPLE_SURVIVES_RECOVERY")
                if result is not None:
                    check(result.get("pressure_sample") == original,
                          "PRESSURE_RETURN_PRESERVES_ORIGINAL_SAMPLE")
            if scenario == "boundary":
                check(rejection is None and result is not None, "PRESSURE_BOUNDARY_STILL_ACCEPTED")
            else:
                expected = {"low free": "final internal free heap is below",
                            "low block": "final largest block is below",
                            "counter rejection": "mqtt_skipped changed during " +
                            ("post-stress Weather recovery" if weather else "live stress")}[scenario]
                check(rejection is not None and expected in rejection and result is None and
                      document["outcome"] == "blocked", "PRESSURE_UNSAFE_SAMPLE_STILL_BLOCKED")
            check(len(status_calls) == (8 if weather else 3) and len(starts) == 3 and len(joins) == 3 and
                  virtual[0] == ns["STRESS_SECONDS"] +
                  ((ns["POST_STRESS_HEADROOM_STABLE_SAMPLES"] - 1) *
                   ns["POST_STRESS_HEADROOM_SAMPLE_INTERVAL_S"] if weather else 0) and
                  refreshes == ([1, 2] if weather else []) and
                  len(routes) == (3 if pending else 2) + (2 if weather else 0) and
                  sum(route.startswith("/ota/check?") for route in routes) == 1,
                  "PRESSURE_NO_EXTRA_DURATION_REQUEST_OR_RETRY")
            check(not any("passed" in phase or "probation_confirmed" in phase
                          for phase in journal.phases), "PRESSURE_FAILURE_CANNOT_CLAIM_ACCEPTANCE")
            public = ns["public_receipt"](journal)
            public_stress = {key: value for key, value in stress.items() if value is not None}
            public_stress["uptime"] = [7, final_uptime]
            if "pressure_sample" in public_stress:
                public_stress["pressure_sample"] = {**stress["pressure_sample"], "uptime": [7, 187]}
            check(final_phase in public["phases"] and public[role]["stress"] ==
                  public_stress, "PRESSURE_PUBLIC_FINAL_SAMPLE_PRESERVED")
            encoded = json.dumps(public)
            check(all(value not in encoded for value in (private, host, mac, str(journal.path))),
                  "PRESSURE_PRIVATE_STATUS_AND_ERROR_STAY_PRIVATE")
            check(not any(key in public[role] for key in ("stress_passed", "probation_confirmed")),
                  "PRESSURE_SAMPLE_IS_NOT_ACCEPTANCE")
            cases += 1
        finally:
            shutil.rmtree(journal.directory)
print(json.dumps({"cases": cases, "checks": checks}))
`;

const run = mode => spawnSync("python3", ["-I", "-B", "-c", probe,
  path.join(root, "scripts/production-ota-gate.py"), mode], {
  encoding: "utf8", timeout: 20_000, maxBuffer: 1024 * 1024,
});
const actual = run("actual");
assert.equal(actual.status, 0, `pressure receipt probe failed: ${actual.stderr}`);
const results = JSON.parse(actual.stdout);
assert.equal(results.cases, 16);
for (const [mode, failure] of [
  ["omit-checkpoint", /PRESSURE_FINAL_SAMPLE_PERSISTED_BEFORE_REJECTION/],
  ["omit-recovery", /PRESSURE_RECOVERY_SAMPLE_PERSISTED_BEFORE_REJECTION/],
]) {
  const omitted = run(mode);
  assert.notEqual(omitted.status, 0, "omitting either final sample checkpoint must fail");
  assert.match(omitted.stderr, failure);
}
console.log(`OTA pressure evidence contract passed (${results.cases} cases, ${results.checks} checks, two omitted-checkpoint controls)`);
