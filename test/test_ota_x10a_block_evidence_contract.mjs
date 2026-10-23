// Every gate block on X10A liveness or its timeout delta must name the sampled facts that separate a
// silent bus (the timeout delta rises) from polling the firmware paused (the delta stays, only
// last_ok_s ages), so a block can be diagnosed without guessing. Runs the real promotion readiness,
// stress_board and probation loops against fake board responses on a virtual clock; this is no
// network or hardware proof.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(process.env.PRODUCTION_OTA_CONTRACT_ROOT ||
  path.join(path.dirname(fileURLToPath(import.meta.url)), ".."));
const gatePath = path.join(root, "scripts/production-ota-gate.py");
const probe = String.raw`
import ast, contextlib, io, json, pathlib, runpy, shutil, sys
from unittest.mock import patch

gate_path, mode = sys.argv[1], sys.argv[2]
gate = runpy.run_path(gate_path, run_name="x10a_block_probe")
ns = gate["stress_board"].__globals__
if mode == "no-evidence":
    ns["x10a_evidence"] = lambda *args, **kwargs: ""
checks = 0
def check(condition, name):
    global checks
    checks += 1
    if not condition:
        raise AssertionError(name)

# 1. Every X10A liveness or timeout block in the status-reading gates carries the evidence.
tree = ast.parse(pathlib.Path(gate_path).read_text())
scopes = {"production_promotion_snapshot_ready", "stress_board", "confirm_ota_probation"}
blocks = []
for function in tree.body:
    if not isinstance(function, ast.FunctionDef) or function.name not in scopes:
        continue
    for node in ast.walk(function):
        if not (isinstance(node, ast.Call) and isinstance(node.func, ast.Name) and
                node.func.id == "fail"):
            continue
        text = "".join(part.value for part in ast.walk(node)
                       if isinstance(part, ast.Constant) and isinstance(part.value, str))
        if "X10A" not in text and "timeout " not in text:
            continue
        carries = any(isinstance(part, ast.Call) and isinstance(part.func, ast.Name) and
                      part.func.id == "x10a_evidence" or
                      isinstance(part, ast.Name) and part.id == "x10a_detail"
                      for part in ast.walk(node))
        blocks.append((node.lineno, text, carries))
check(len(blocks) == 11, "X10A_BLOCK_INVENTORY: lines " + str([line for line, _, _ in blocks]))
for line, text, carries in blocks:
    check(carries, "X10A_FAIL_CARRIES_EVIDENCE[line " + str(line) + "]: " + text)

limit = ns["MAX_X10A_TIMEOUT_DELTA"]
def oracle(hp):
    # Independent of the gate's formatter; every fixture baseline has timeout_err 0.
    return ("connected=" + str(hp["connected"]).lower() + ", values=" + str(hp["values"]) +
            ", last_ok_s=" + str(hp["last_ok_s"]) + ", timeout delta " + str(hp["timeout_err"]) +
            ", limit " + str(limit))

# 2. The formatter itself: bounded facts, never board-supplied text.
if mode != "no-evidence":
    evidence = ns["x10a_evidence"]
    base = {"timeout_err": 5}
    check(evidence({"hp": {"connected": False, "values": 0, "last_ok_s": 16, "timeout_err": 5}},
                   base) == "connected=false, values=0, last_ok_s=16, timeout delta 0, limit " +
          str(limit), "EVIDENCE_PAUSED_POLLING")
    check(evidence({"hp": {"connected": True, "values": 129, "last_ok_s": 1, "timeout_err": 9}},
                   base) == "connected=true, values=129, last_ok_s=1, timeout delta 4, limit " +
          str(limit), "EVIDENCE_SILENT_BUS")
    absent = "connected=absent, values=absent, last_ok_s=absent, timeout delta unknown, limit " + \
        str(limit)
    check(evidence({"hp": {}}, base) == absent and evidence({}, base) == absent and
          evidence({"hp": "private-text"}, base) == absent, "EVIDENCE_ABSENT_FIELDS")
    malformed = evidence({"hp": {"connected": "private-text", "values": "private-text",
                                 "last_ok_s": 1.5, "timeout_err": True}}, base)
    check(malformed == "connected=malformed, values=malformed, last_ok_s=malformed, "
          "timeout delta unknown, limit " + str(limit) and "private-text" not in malformed,
          "EVIDENCE_NEVER_ECHOES_BOARD_TEXT")

# 3. The real gate loops.
version, elf, sha, mac = "2.0.0-dev.2", "abcdef123", "a" * 64, "02:00:00:00:00:01"
host = "production.invalid"
heap = {"free_heap": max(ns["POST_STRESS_MIN_FREE_HEAP"], ns["MIN_FINAL_FREE_HEAP"]) + 8192,
        "max_alloc": max(ns["POST_STRESS_MIN_LARGEST_BLOCK"], ns["MIN_FINAL_LARGEST_BLOCK"]) + 8192}
LIVE = {"connected": True, "values": 129, "last_ok_s": 1, "crc_err": 0, "timeout_err": 0}
# What /status reports once a manifest check held X10A polling past the firmware's recency bound.
PAUSED = {"connected": False, "values": 0, "last_ok_s": 16, "crc_err": 0, "timeout_err": 0}
SILENT = {"connected": True, "values": 129, "last_ok_s": 1, "crc_err": 0, "timeout_err": limit + 1}
def board(uptime, hp=LIVE, refresh=2):
    return {"version": version, "app_elf_sha256": elf, "uptime_s": uptime,
        "wifi": {"mac": mac, "connected": True, "rolled_back": False, "ssid": "ExampleNet"},
        "mqtt": {"connected": True, "broker": "private"},
        "weather_forecast": {"configured": True, "fetching": False, "latitude": "1.0",
            "longitude": "2.0", "successes": int(refresh == 2), "errors": 0,
            "state": "ok" if refresh == 2 else "waiting",
            "reason": "" if refresh == 2 else "heap_headroom",
            "fetched_at": 1700000000 if refresh == 2 else 0,
            "refresh_requested_token": refresh, "refresh_started_token": refresh,
            "refresh_completed_token": refresh, "refresh_success_token": 2 if refresh == 2 else 0},
        "sys": {"safe_mode": False, "heap_restarts": 0, "poll_skipped": 0, "mqtt_skipped": 0, **heap},
        "hp": dict(hp)}
baseline = ns["board_counters"](board(7))

def forbidden(*args, **kwargs):
    raise AssertionError("PROBE_UNEXPECTED_IO")

def run_stress(status, *, weather, sync_workers):
    virtual, start_at, refreshes = [0.0], [], []
    def request_json(endpoint, route, **kwargs):
        if route == "/set_weather":
            check(kwargs.get("method") == "POST" and kwargs["payload"].get("refresh") is True,
                  "PROBE_ONLY_NONPERSISTENT_REFRESH")
            refreshes.append(len(refreshes) + 1)
            return {"ok": True, "reboot": False, "saved": False, "refresh_requested": True,
                    "refresh_token": refreshes[-1]}
        check(kwargs.get("method", "GET") == "GET", "PROBE_NO_WRITES")
        if route.startswith("/ota/check?"):
            return {"ok": True, "generation": 7}
        return {"generation": 7, "busy": False, "state": "idle", "available": version,
                "available_sha256": sha, "available_channel": "dev"}
    class Worker:
        # Synchronous: run each probe loop to its deadline from the same virtual start, so the loops'
        # timelines overlap as the board's concurrent threads do. Otherwise skip the probes entirely.
        def __init__(self, **kwargs):
            self.target, self.args = kwargs["target"], kwargs.get("args", ())
        def start(self):
            if not start_at:
                start_at.append(virtual[0])
            if sync_workers:
                virtual[0] = start_at[0]
                self.target(*self.args)
        def join(self, timeout):
            if not sync_workers:
                virtual[0] = start_at[0] + float(ns["STRESS_SECONDS"])
        def is_alive(self): return False
    original_checkpoint = ns["journal_checkpoint"]
    def checkpoint(phase, **updates):
        if phase == "production_pressure_started":
            # Neither the scheduled-window refusals nor the probe counts are this probe's subject.
            stress = updates["production"]["stress"]
            stress["tls_busy_503"].update({"status": 1, "values": 1})
            if not sync_workers:
                stress["samples"].update({"status": 300, "values": 120, "diag": 10})
        original_checkpoint(phase, **updates)
    output = io.StringIO()
    with contextlib.redirect_stdout(output), contextlib.redirect_stderr(output):
        journal = ns["GateJournal"]()
    try:
        with patch.dict(ns, {"ACTIVE_JOURNAL": journal, "resolve_http_endpoint": lambda value: value,
                             "request_status_deadline": lambda endpoint, **kwargs:
                                 status(virtual[0] - (start_at[0] if start_at else 0.0), bool(start_at)),
                             "request_values_deadline": lambda endpoint, **kwargs: {"values": []},
                             "request_diag_deadline": lambda endpoint, **kwargs: b"diag",
                             "request_json_deadline": request_json, "journal_checkpoint": checkpoint,
                             "post_update_once": forbidden}), \
            patch.object(ns["threading"], "Thread", Worker), \
            patch.object(ns["time"], "monotonic", lambda: virtual[0]), \
            patch.object(ns["time"], "time", lambda: 1700000000.0), \
            patch.object(ns["time"], "sleep", lambda seconds: virtual.__setitem__(0, virtual[0] + seconds)), \
            patch.object(ns["socket"], "create_connection", forbidden), \
            patch.object(ns["socket"], "getaddrinfo", forbidden):
            try:
                ns["stress_board"](host=host, mac=mac, version=version, elf=elf, require_x10a=True,
                    require_weather=weather, expected_app_sha256=sha, expected_channel="dev")
            except ns["GateError"] as error:
                return str(error)
        return None
    finally:
        shutil.rmtree(journal.directory)

def headroom_board(replace_at, hp):
    # The deferred-Weather path: readiness, deferral, MQTT recovery, stress end, two headroom
    # samples, the recovery fetch and the final MQTT sample (as test_ota_pressure_evidence_contract).
    sequence = [(7, 0), (8, 1), (9, 1), (187, 1), (188, 1), (189, 1), (190, 2), (194, 2)]
    calls = [0]
    def status(relative, started):
        index = min(calls[0], len(sequence) - 1)
        calls[0] += 1
        uptime, refresh = sequence[index]
        return board(uptime, hp if index == replace_at else LIVE, refresh)
    return status

def stress_sample(at):
    # One /status sample inside the live window reports paused polling; every other one is live.
    reported = [False]
    def status(relative, started):
        if started and relative >= at and not reported[0]:
            reported[0] = True
            return board(7 + int(relative), PAUSED)
        return board(7 + int(relative))
    return status

results = {
    "healthy deferred run": run_stress(headroom_board(None, LIVE), weather=True, sync_workers=False),
    "healthy live stress": run_stress(stress_sample(10 ** 9), weather=False, sync_workers=True),
    "readiness pause": run_stress(lambda relative, started: board(7, PAUSED), weather=True,
                                  sync_workers=False),
    "stress sample pause": run_stress(stress_sample(60.0), weather=False, sync_workers=True),
    "stress end silent bus": run_stress(headroom_board(3, SILENT), weather=True, sync_workers=False),
    "headroom pause": run_stress(headroom_board(4, PAUSED), weather=True, sync_workers=False),
    "headroom silent bus": run_stress(headroom_board(4, SILENT), weather=True, sync_workers=False),
    "recovery pause": run_stress(headroom_board(7, PAUSED), weather=True, sync_workers=False),
    "recovery silent bus": run_stress(headroom_board(7, SILENT), weather=True, sync_workers=False),
}

def direct(call):
    try:
        call()
    except ns["GateError"] as error:
        return str(error)
    return None
promotion = ns["production_promotion_snapshot_ready"]
for name, hp in (("promotion pause", PAUSED), ("promotion silent bus", SILENT)):
    results[name] = direct(lambda: promotion(board(9, hp), baseline_counters=baseline, last_uptime=7))

def probation(hp):
    clock = [0.0]
    with patch.dict(ns, {"resolve_http_endpoint": lambda value: value,
                         "request_status_deadline": lambda endpoint, **kwargs: board(190, hp),
                         "request_json_deadline": forbidden}), \
        patch.object(ns["time"], "monotonic", lambda: clock[0]), \
        patch.object(ns["time"], "sleep", lambda seconds: clock.__setitem__(0, clock[0] + seconds)):
        return direct(lambda: ns["confirm_ota_probation"](host=host, mac=mac, version=version,
            elf=elf, stress={"uptime": [7, 187], "counters_after": baseline}, require_x10a=True))
for name, hp in (("probation pause", PAUSED), ("probation silent bus", SILENT)):
    results[name] = probation(hp)

for name in ("healthy deferred run", "healthy live stress"):
    check(results[name] is None, "X10A_FIXTURE_HEALTHY_RUN_PASSES[" + name + "]: " + str(results[name]))
expected = {
    "readiness pause": ("X10A did not connect or deliver values before the pressure window", PAUSED),
    "stress sample pause": ("lost a required MQTT/X10A connection in 1 status samples; X10A in 1 "
                            "of them, first at +60.00s", PAUSED),
    "stress end silent bus": ("X10A timeout delta exceeded " + str(limit), SILENT),
    "headroom pause": ("lost X10A while waiting for post-stress headroom", PAUSED),
    "headroom silent bus": ("X10A timeout delta exceeded " + str(limit), SILENT),
    "recovery pause": ("lost X10A during post-stress Weather recovery", PAUSED),
    "recovery silent bus": ("X10A timeout delta exceeded " + str(limit), SILENT),
    "promotion pause": ("production X10A must remain live while waiting for promotion readiness",
                        PAUSED),
    "promotion silent bus": ("production X10A timeout delta exceeded " + str(limit) +
                             " before promotion", SILENT),
    "probation pause": ("probation confirmation lost MQTT or X10A liveness", PAUSED),
    "probation silent bus": ("timeout counter regressed or exceeded its confirmation allowance",
                             SILENT),
}
for name, (site, hp) in expected.items():
    rejection = results[name] or ""
    check(site + " (" + oracle(hp) + ")" in rejection,
          "X10A_BLOCK_NAMES_EVIDENCE[" + name + "]: " + rejection)
print(json.dumps({"checks": checks, "scenarios": len(results)}))
`;

const run = (mode, file = gatePath) => spawnSync("python3", ["-I", "-B", "-c", probe, file, mode], {
  encoding: "utf8", timeout: 60_000, maxBuffer: 1024 * 1024,
});

const actual = run("actual");
assert.equal(actual.status, 0, `X10A block evidence probe failed: ${actual.stderr}`);
const { checks, scenarios } = JSON.parse(actual.stdout);
assert.equal(scenarios, 13);

// Negative control 1: blocks that keep their wording but lose the evidence must fail the probe.
const blank = run("no-evidence");
assert.notEqual(blank.status, 0, "an evidence-free formatter must fail the probe");
assert.match(blank.stderr, /X10A_BLOCK_NAMES_EVIDENCE/);

// Negative control 2: the 2026-10-23 incident's site reverted to its evidence-free message.
// Seeded on a scratch copy of the real gate, never on the source.
const source = fs.readFileSync(gatePath, "utf8");
const site = /(fail\(f"\{host\} lost X10A while waiting for post-stress headroom) "\n\s+f"\(\{x10a_evidence\(candidate, baseline\)\}\)"\)/;
assert.equal(source.split(site).length, 3, "the post-stress headroom X10A block must exist exactly once");
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "x10a-block-evidence-"));
try {
  const mutant = path.join(scratch, "gate.py");
  fs.writeFileSync(mutant, source.replace(site, '$1")'));
  const reverted = run("actual", mutant);
  assert.notEqual(reverted.status, 0, "a reverted evidence-free block must fail the probe");
  assert.match(reverted.stderr, /X10A_FAIL_CARRIES_EVIDENCE/);
} finally {
  fs.rmSync(scratch, { recursive: true, force: true });
}
console.log(`OTA X10A block evidence contract passed (${checks} checks, ${scenarios} scenarios, two mutation controls)`);
