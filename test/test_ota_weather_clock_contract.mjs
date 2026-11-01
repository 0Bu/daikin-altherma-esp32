// The board starts no Weather fetch before SNTP has set its clock. While the board itself reports
// `ntp.synced: false`, the gate waits before its excused TLS window, within CLOCK_SYNC_WAIT_MAX_S,
// and extends the pressure window as it waits; the sample minima scale with the longer window, and
// a clock that never syncs blocks with a message that names it. Without the board's own report it
// does not wait. Runs the real stress_board main loop against fake board responses on a virtual
// clock with the probe workers stubbed; this is no network or hardware proof.
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
import contextlib, io, json, runpy, shutil, sys
from unittest.mock import patch

gate = runpy.run_path(sys.argv[1], run_name="weather_clock_probe")
ns = gate["stress_board"].__globals__
checks = 0
def check(condition, name):
    global checks
    checks += 1
    if not condition:
        raise AssertionError(name)

version, elf, sha, mac = "2.0.0-dev.2", "abcdef123", "a" * 64, "02:00:00:00:00:01"
host = "production.invalid"
heap = {"free_heap": max(ns["POST_STRESS_MIN_FREE_HEAP"], ns["MIN_FINAL_FREE_HEAP"]) + 8192,
        "max_alloc": max(ns["POST_STRESS_MIN_LARGEST_BLOCK"], ns["MIN_FINAL_LARGEST_BLOCK"]) + 8192}
LIVE = {"connected": True, "values": 129, "last_ok_s": 1, "crc_err": 0, "timeout_err": 0}
FETCH_S = 4.0
# Later than both the refresh wait (OTA_CHECK_TIMEOUT_S) and the pressure window (STRESS_SECONDS),
# so only a wait that also keeps the window open lets the refresh complete with probes running.
LATE_SYNC_S = float(max(ns["OTA_CHECK_TIMEOUT_S"], ns["STRESS_SECONDS"]) + 20)
check(LATE_SYNC_S + FETCH_S < ns["CLOCK_SYNC_WAIT_MAX_S"], "FIXTURE_LATE_SYNC_WITHIN_BOUND")
BASE = {"status": ns["MIN_STATUS_SAMPLES"], "values": ns["MIN_VALUES_SAMPLES"],
        "diag": ns["MIN_DIAG_SAMPLES"]}
AMPLE = {kind: 10 * count for kind, count in BASE.items()}
# scenario: (ntp "synced" as a function of window-relative seconds, or None for no report and
# "null" for a non-boolean report; fetch start; injected probe samples)
scenarios = {
    "synced": (lambda relative: True, 2.0, AMPLE),
    "late sync": (lambda relative: relative >= LATE_SYNC_S, LATE_SYNC_S + 2.0, AMPLE),
    "late sync at base rate": (lambda relative: relative >= LATE_SYNC_S, LATE_SYNC_S + 2.0, BASE),
    "never syncs": (lambda relative: False, None, AMPLE),
    "no ntp report": (None, LATE_SYNC_S + 2.0, AMPLE),
    "null ntp report": ("null", LATE_SYNC_S + 2.0, AMPLE),
}

def forbidden(*args, **kwargs):
    raise AssertionError("PROBE_UNEXPECTED_IO")

def run(name):
    synced_at, fetch_at, injected = scenarios[name]
    virtual, start_at, refreshes, joins = [0.0], [], [], []
    def board(relative):
        requested = 1 if refreshes else 0
        started = int(bool(refreshes) and fetch_at is not None and relative >= fetch_at)
        done = int(bool(refreshes) and fetch_at is not None and relative >= fetch_at + FETCH_S)
        status = {"version": version, "app_elf_sha256": elf, "uptime_s": 7 + int(relative),
            "wifi": {"mac": mac, "connected": True, "rolled_back": False, "ssid": "ExampleNet"},
            "mqtt": {"connected": True, "broker": "private"},
            "weather_forecast": {"configured": True, "latitude": "12.345678",
                "longitude": "23.456789", "fetching": bool(started and not done),
                "successes": 1 + done, "errors": 0, "state": "ok", "reason": "",
                "fetched_at": 1700000000, "refresh_requested_token": requested,
                "refresh_started_token": started, "refresh_completed_token": done,
                "refresh_success_token": done},
            "sys": {"safe_mode": False, "heap_restarts": 0, "poll_skipped": 0, "mqtt_skipped": 0,
                    **heap},
            "hp": dict(LIVE)}
        if synced_at == "null":
            status["ntp"] = {"server": "pool.ntp.org", "synced": None, "time": None}
        elif synced_at is not None:
            status["ntp"] = {"server": "pool.ntp.org", "synced": synced_at(relative),
                             "time": "2026-01-01T00:00:00.000Z"}
        return status
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
        # The probes are not this contract's subject: they never run, and join records how much of
        # the shared pressure deadline is still left when the gate stops them.
        def __init__(self, **kwargs): pass
        def start(self):
            if not start_at:
                start_at.append(virtual[0])
        def join(self, timeout): joins.append(timeout)
        def is_alive(self): return False
    original_checkpoint = ns["journal_checkpoint"]
    def checkpoint(phase, **updates):
        if phase == "production_pressure_started":
            stress = updates["production"]["stress"]
            stress["tls_busy_503"].update({"status": 1, "values": 1})
            stress["samples"].update(injected)
        original_checkpoint(phase, **updates)
    output = io.StringIO()
    with contextlib.redirect_stdout(output), contextlib.redirect_stderr(output):
        journal = ns["GateJournal"]()
    result, rejection, journaled = None, None, {}
    try:
        with patch.dict(ns, {"ACTIVE_JOURNAL": journal, "resolve_http_endpoint": lambda value: value,
                             "request_status_deadline": lambda endpoint, **kwargs:
                                 board(virtual[0] - (start_at[0] if start_at else virtual[0])),
                             "request_values_deadline": forbidden, "request_diag_deadline": forbidden,
                             "request_json_deadline": request_json, "journal_checkpoint": checkpoint,
                             "post_update_once": forbidden}), \
            patch.object(ns["threading"], "Thread", Worker), \
            patch.object(ns["time"], "monotonic", lambda: virtual[0]), \
            patch.object(ns["time"], "time", lambda: 1700000000.0), \
            patch.object(ns["time"], "sleep", lambda seconds: virtual.__setitem__(0, virtual[0] + seconds)), \
            patch.object(ns["socket"], "create_connection", forbidden), \
            patch.object(ns["socket"], "getaddrinfo", forbidden):
            try:
                result = ns["stress_board"](host=host, mac=mac, version=version, elf=elf,
                    require_x10a=True, require_weather=True, expected_app_sha256=sha,
                    expected_channel="dev")
            except ns["GateError"] as error:
                rejection = str(error)
        document = json.loads(journal.path.read_text())
        journaled = document["receipt"]["production"].get("stress", {})
    finally:
        shutil.rmtree(journal.directory)
    return result, rejection, refreshes, joins, journaled

results = {name: run(name) for name in scenarios}
slack = ns["HTTP_TIMEOUT_S"] + 1

result, rejection, refreshes, joins, journaled = results["synced"]
check(rejection is None and result is not None, "WEATHER_CLOCK_SYNCED_RUN_PASSES: " + str(rejection))
check(result["weather_refresh"]["clock_wait_s"] == 0 and journaled.get("clock_wait_s") == 0 and
      refreshes == [1], "WEATHER_CLOCK_SYNCED_RUN_WAITS_FOR_NOTHING")

result, rejection, refreshes, joins, journaled = results["late sync"]
check(rejection is None and result is not None,
      "WEATHER_CLOCK_LATE_SYNC_PASSES: " + str(rejection))
wait = result["weather_refresh"]["clock_wait_s"] if result else -1
check(LATE_SYNC_S - 2 <= wait <= LATE_SYNC_S + 2 and journaled.get("clock_wait_s") == wait and
      refreshes == [1], "WEATHER_CLOCK_LATE_SYNC_RECORDS_ITS_WAIT: " + str(wait))
# Without the extension the window would already be over when the refresh completes (join gets only
# its fixed slack); with it, the probes still have most of their window left.
check(len(joins) == 3 and all(timeout > slack + ns["STRESS_SECONDS"] / 2 for timeout in joins),
      "WEATHER_CLOCK_EXTENDS_PRESSURE_WINDOW: " + str(joins))

result, rejection, refreshes, joins, journaled = results["late sync at base rate"]
check(result is None and rejection is not None and
      "live stress produced too few successful samples" in rejection,
      "WEATHER_CLOCK_SCALES_SAMPLE_MINIMA: " + str(rejection))

result, rejection, refreshes, joins, journaled = results["never syncs"]
check(result is None and rejection is not None and refreshes == [] and
      "clock did not synchronize within " + str(ns["CLOCK_SYNC_WAIT_MAX_S"]) + "s" in rejection,
      "WEATHER_CLOCK_NEVER_SYNCS_NAMES_THE_CLOCK: " + str(rejection))

for name in ("no ntp report", "null ntp report"):
    result, rejection, refreshes, joins, journaled = results[name]
    check(result is None and rejection is not None and refreshes == [1] and
          rejection.endswith("did not complete the explicitly triggered weather TLS refresh"),
          "WEATHER_CLOCK_NEEDS_THE_BOARD_REPORT[" + name + "]: " + str(rejection))
print(json.dumps({"checks": checks, "scenarios": len(results)}))
`;

const run = file => spawnSync("python3", ["-I", "-B", "-c", probe, file], {
  encoding: "utf8", timeout: 120_000, maxBuffer: 1024 * 1024,
});

const actual = run(gatePath);
assert.equal(actual.status, 0, `weather clock probe failed: ${actual.stderr}`);
const { checks, scenarios } = JSON.parse(actual.stdout);
assert.equal(scenarios, 6);

// Negative controls on scratch copies of the real gate, never on the source: no clock wait at all,
// a wait that leaves the pressure window unextended, and minima that ignore the longer window.
const source = fs.readFileSync(gatePath, "utf8");
const report = 'unsynced = isinstance(ntp_state, dict) and ntp_state.get("synced") is False';
const window = "\n            deadline += now - clock_checked_at\n";
const scale = "window_scale = max(1.0, (deadline - stress_started) / STRESS_SECONDS)";
for (const marker of [report, window, scale]) {
  assert.equal(source.split(marker).length, 2, `the gate must contain ${JSON.stringify(marker)} once`);
}
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "weather-clock-"));
try {
  for (const [old, replacement, failure] of [
    [report, "unsynced = False", /WEATHER_CLOCK_LATE_SYNC_PASSES/],
    // Without it the stale window also caps the refresh wait, so the refresh cannot even finish.
    [window, "\n            pass\n", /WEATHER_CLOCK_(EXTENDS_PRESSURE_WINDOW|LATE_SYNC_PASSES)/],
    [scale, "window_scale = 1.0", /WEATHER_CLOCK_SCALES_SAMPLE_MINIMA/],
  ]) {
    const mutant = path.join(scratch, "gate.py");
    fs.writeFileSync(mutant, source.replace(old, replacement));
    const result = run(mutant);
    assert.notEqual(result.status, 0, `the mutant ${JSON.stringify(replacement)} must fail the probe`);
    assert.match(result.stderr, failure);
  }
} finally {
  fs.rmSync(scratch, { recursive: true, force: true });
}
console.log(`OTA weather clock contract passed (${checks} checks, ${scenarios} scenarios, three mutation controls)`);
