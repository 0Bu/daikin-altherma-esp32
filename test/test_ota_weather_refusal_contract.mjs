// No gate pressure window (bench delivery, promotion round trip, production, lab-HIL) may turn the
// firmware's own bounded Weather refusal into a blocking stress error, and each must still block every
// other /values 503. Runs the real stress_board worker loops against fake board responses on a virtual
// clock; this is no network or hardware proof.
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
import contextlib, copy, io, json, runpy, shutil, sys
from unittest.mock import patch

gate = runpy.run_path(sys.argv[1], run_name="weather_refusal_probe")
ns = gate["stress_board"].__globals__
mode = sys.argv[2]
if mode == "always-explained":
    ns["weather_tls_refusal_explained"] = lambda *args, **kwargs: True
checks = 0
def check(condition, name):
    global checks
    checks += 1
    if not condition:
        raise AssertionError(name)

# 1. The rule itself.
explain = ns["weather_tls_refusal_explained"]
busy = ns["WEATHER_TLS_BUSY_TEXT"]
margin = ns["WEATHER_TLS_EVIDENCE_MARGIN_S"]
witness = [(10.0, False), (11.0, True), (16.0, False)]
check(explain("values", busy, 11.5, 15.5, witness), "RULE_ACCEPTS_BOARD_WITNESSED_REFUSAL")
check(explain("values", busy, 11.0 + margin, 14.0, [(11.0, True)]), "RULE_MARGIN_IS_INCLUSIVE")
# The sole HTTP worker parks inside the refusal, so the board's report may only arrive after it.
check(explain("values", busy, 20.0, 24.0, [(19.0, False), (24.0 + margin, True)]),
      "RULE_ACCEPTS_WITNESS_ARRIVING_AFTER_REFUSAL")
classify = ns["classify_weather_refusals"]
cap = ns["MAX_WEATHER_REFUSALS_PER_EPISODE"]
one_episode = [(at / 4.0, True) for at in range(0, 160)] + [(41.0, False)]
accepted, unexplained = classify([(5.0 * n, 5.0 * n + 4.0, busy) for n in range(cap + 1)], one_episode)
if mode != "always-explained":
    check(accepted == cap and [reason for _, reason in unexplained] ==
          ["beyond " + str(cap) + " per Weather fetch"], "CLASSIFY_CAPS_ONE_WEATHER_FETCH")
two_episodes = [(1.0, True), (3.0, False), (21.0, True), (23.0, False)]
accepted, unexplained = classify([(0.5, 4.5, busy), (1.0, 2.5, busy), (20.5, 24.5, busy),
                                  (21.0, 22.5, busy), (40.0, 44.0, busy), (0.5, 4.5, "heap low")],
                                 two_episodes)
if mode != "always-explained":
    check(accepted == 2 * cap and unexplained == [(4, "no board Weather witness"),
                                                  (5, "not the firmware TLS-busy refusal")],
          "CLASSIFY_CAPS_EACH_EPISODE_AND_NAMES_REASONS")
window_cap = ns["MAX_WEATHER_REFUSALS_PER_WINDOW"]
fetches = [(at, (at // 20) % 2 == 0 and at % 20 < 6) for at in range(0, 200)]  # fetches at 0, 40, 80..
refusals = [(40.0 * n + offset, 40.0 * n + offset + 4.0, busy) for n in range(5) for offset in (0.5, 1.0)]
accepted, unexplained = classify(refusals, fetches)
if mode != "always-explained":
    check(accepted == window_cap and [reason for _, reason in unexplained] ==
          ["beyond " + str(window_cap) + " per pressure window"] * (len(refusals) - window_cap),
          "CLASSIFY_CAPS_THE_WINDOW_ACROSS_FETCHES")
# The third refusal's evidence spans the exhausted first fetch and a fresh second one.
spanning = [(at / 4.0, True) for at in range(0, 21)] + [(5.5, False), (5.75, True), (9.0, False)]
accepted, unexplained = classify([(0.5, 4.5, busy), (1.0, 4.6, busy), (4.8, 5.2, busy)], spanning)
check(accepted == 3 and unexplained == [], "CLASSIFY_CHARGES_A_FRESH_FETCH_WITH_CAPACITY")
if mode != "always-explained":
    check(not explain("values", "heap low", 11.5, 15.5, witness), "RULE_REJECTS_OTHER_REFUSAL_TEXT")
    check(not explain("status", busy, 11.5, 15.5, witness), "RULE_IS_VALUES_ONLY")
    check(not explain("values", busy, 11.5, 15.5, [(11.0, False), (16.0, False)]),
          "RULE_REQUIRES_FETCHING_WITNESS")
    check(not explain("values", busy, 30.0, 34.0, witness), "RULE_REQUIRES_WITNESS_NEAR_REQUEST")
check(ns["printable_error_text"](b"heap\x00low\n" + b"x" * 200) ==
      "heap?low?" + "x" * (ns["HTTP_ERROR_TEXT_MAX"] - 9), "ERROR_TEXT_IS_BOUNDED_AND_PRINTABLE")
check(ns["http_error_text"](ns["HTTPError"]("http://x.invalid/", 503, "m", None, None)) == "",
      "UNTEXTED_HTTP_ERROR_HAS_NO_TEXT")
class FileForwardingHTTPError(ns["HTTPError"]):
    # Python 3.9's HTTPError without a response file: unknown attributes raise KeyError('file').
    def __getattr__(self, name):
        raise KeyError("file")
check(ns["http_error_text"](FileForwardingHTTPError("http://x.invalid/", 503, "m", None, None)) == "",
      "UNTEXTED_HTTP_ERROR_HAS_NO_TEXT_ON_PYTHON_3_9")

# 2. The real worker loops and their final classification.
version, elf, sha, mac = "2.0.0-dev.2", "abcdef123", "a" * 64, "02:00:00:00:00:01"
host = "bench.invalid"
REFUSAL_WAIT_S = 4.0            # the firmware's bounded wait before its refusal
# "values": refusing /values call indexes. A call index k starts at k + 4 s per earlier refusal:
# (60, 100) at 60 and 104 s, (60, 61, 62) at 60, 65 and 70 s, (60, 61, 100, 101) at 60, 65, 108 and
# 113 s, and (60, 61, 100, 101, 140, 141) adds 156 and 161 s. "fetching": the board's Weather windows.
# "diag" refuses diag call 4 (60 s); "status" refuses the /status sample at 60 s.
ONE_FETCH, TWO_FETCHES = ((58.5, 66.0),), ((58.5, 66.0), (102.5, 110.0))
scenarios = {
    "explained": {"values": (60, 61, 100, 101), "fetching": ((58.5, 71.0), (106.5, 119.0))},
    "witness after refusal": {"values": (60,), "fetching": ((64.5, 66.0),)},
    "over fetch cap": {"values": (60, 61, 62), "fetching": ((58.5, 80.0),)},
    "over window cap": {"values": (60, 61, 100, 101, 140, 141),
                        "fetching": ((58.5, 71.0), (106.5, 119.0), (154.5, 167.0))},
    "no witness": {"values": (60, 100), "fetching": ()},
    "other text": {"values": (60, 100), "fetching": TWO_FETCHES, "text": "heap low"},
    "distant witness": {"values": (60, 100), "fetching": ((30.0, 40.0),)},
    "values 500": {"values": (60,), "fetching": ONE_FETCH, "code": 500},
    "diag refusal": {"diag": 4, "fetching": ONE_FETCH},
    "status refusal": {"status": 60.0, "fetching": ONE_FETCH},
}
results = {}
for name, scenario in scenarios.items():
    refuse_at, fetching_windows = scenario.get("values", ()), scenario["fetching"]
    text, code = scenario.get("text", busy), scenario.get("code", 503)
    virtual = [0.0]
    start_at = []
    status_calls, values_calls = [0], [0]
    def board(fetching=False):
        return {"version": version, "app_elf_sha256": elf, "uptime_s": 7 + int(virtual[0]),
            "wifi": {"mac": mac, "connected": True, "rolled_back": False, "ssid": "ExampleNet"},
            "mqtt": {"connected": True, "broker": "private"},
            "weather_forecast": {"configured": True, "fetching": fetching, "successes": 1,
                                 "errors": 0, "state": "ok", "reason": ""},
            "sys": {"safe_mode": False, "heap_restarts": 0, "poll_skipped": 0, "mqtt_skipped": 0,
                    "free_heap": ns["POST_STRESS_MIN_FREE_HEAP"] + 8192,
                    "max_alloc": ns["POST_STRESS_MIN_LARGEST_BLOCK"] + 8192},
            "hp": {"connected": False, "values": 0, "crc_err": 0, "timeout_err": 0}}
    def refusal(route, status_code=503):
        error = ns["HTTPError"]("http://bench.invalid" + route, status_code, "HTTP request failed",
                                None, None)
        error.gate_text = text
        return error
    status_refused = [False]
    def status(endpoint, **kwargs):
        status_calls[0] += 1
        relative = virtual[0] - (start_at[0] if start_at else 0.0)
        if start_at and "status" in scenario and not status_refused[0] and relative >= scenario["status"]:
            status_refused[0] = True
            raise refusal("/status")
        fetching = bool(start_at) and any(low <= relative <= high for low, high in fetching_windows)
        return board(fetching)
    def values(endpoint, **kwargs):
        index = values_calls[0]
        values_calls[0] += 1
        if index in refuse_at:
            virtual[0] += REFUSAL_WAIT_S
            raise refusal("/values", code)
        return {"values": []}
    diag_calls = [0]
    def diag(endpoint, **kwargs):
        index = diag_calls[0]
        diag_calls[0] += 1
        if index == scenario.get("diag"):
            raise refusal("/diag")
        return b"diag"
    ota_reads = [0]
    def request_json(endpoint, route, **kwargs):
        check(kwargs.get("method", "GET") == "GET", "PROBE_NO_WRITES")
        if route.startswith("/ota/check?"):
            return {"ok": True, "generation": 7}
        ota_reads[0] += 1
        if ota_reads[0] == 1:
            return {"image_state": "pending_verify", "rollback_pending": True}
        return {"generation": 7, "busy": False, "state": "idle", "available": version,
                "available_sha256": sha, "available_channel": "dev"}
    class SyncWorker:
        # Run each probe loop to its deadline from the same virtual start, so the three loops'
        # timelines overlap as the concurrent threads' do on a board.
        def __init__(self, **kwargs):
            self.target, self.args = kwargs["target"], kwargs.get("args", ())
        def start(self):
            if not start_at:
                start_at.append(virtual[0])
            virtual[0] = start_at[0]
            self.target(*self.args)
        def join(self, timeout): pass
        def is_alive(self): return False
    def forbidden(*args, **kwargs):
        raise AssertionError("PROBE_UNEXPECTED_IO")
    original_checkpoint = ns["journal_checkpoint"]
    def checkpoint(phase, **updates):
        if phase == "bench_cold_pressure_started":
            # The scheduled-window refusals are not this probe's subject; model their witness.
            updates["test_board"]["stress"]["tls_busy_503"].update({"status": 1, "values": 1})
        original_checkpoint(phase, **updates)
    output = io.StringIO()
    with contextlib.redirect_stdout(output), contextlib.redirect_stderr(output):
        journal = ns["GateJournal"]()
    result, rejection = None, None
    try:
        with patch.dict(ns, {"ACTIVE_JOURNAL": journal, "resolve_http_endpoint": lambda value: value,
                             "request_status_deadline": status, "request_values_deadline": values,
                             "request_diag_deadline": diag,
                             "request_json_deadline": request_json, "journal_checkpoint": checkpoint,
                             "post_update_once": forbidden}), \
            patch.object(ns["threading"], "Thread", SyncWorker), \
            patch.object(ns["time"], "monotonic", lambda: virtual[0]), \
            patch.object(ns["time"], "time", lambda: 1700000000.0), \
            patch.object(ns["time"], "sleep", lambda seconds: virtual.__setitem__(0, virtual[0] + seconds)), \
            patch.object(ns["socket"], "create_connection", forbidden), \
            patch.object(ns["socket"], "getaddrinfo", forbidden):
            try:
                result = ns["stress_board"](host=host, mac=mac, version=version, elf=elf,
                    require_x10a=False, require_weather=False, expected_app_sha256=sha,
                    expected_channel="dev", require_pending_image=True)
            except ns["GateError"] as error:
                rejection = str(error)
        document = json.loads(journal.path.read_text())
        stress = document["receipt"]["test_board"].get("stress", {})
        results[name] = {"rejection": rejection, "passed": result is not None,
                         "firmware_weather": stress.get("firmware_weather_busy_503"),
                         "public": ns["public_receipt"](journal)["test_board"]["stress"]
                                   .get("firmware_weather_busy_503")}
    finally:
        shutil.rmtree(journal.directory)

for name, count in (("explained", 4), ("witness after refusal", 1)):
    result = results[name]
    check(result["passed"] and result["rejection"] is None,
          "EXPLAINED_REFUSAL_DOES_NOT_BLOCK[" + name + "]: " + str(result["rejection"]))
    check(result["firmware_weather"] == {"values": count} and result["public"] == {"values": count},
          "EXPLAINED_REFUSALS_ARE_COUNTED_IN_RECEIPT[" + name + "]")
fetch_cap = "beyond " + str(ns["MAX_WEATHER_REFUSALS_PER_EPISODE"]) + " per Weather fetch"
window = "beyond " + str(ns["MAX_WEATHER_REFUSALS_PER_WINDOW"]) + " per pressure window"
# (scenario, kind and status in the error, refusal text, start second, deferred reason or None, counted)
for name, prefix, marker, at, reason, counted in (
        ("no witness", "values: HTTP Error 503", busy, 60, "no board Weather witness", 0),
        ("other text", "values: HTTP Error 503", "heap low", 60, "not the firmware TLS-busy refusal", 0),
        ("distant witness", "values: HTTP Error 503", busy, 60, "no board Weather witness", 0),
        ("over fetch cap", "values: HTTP Error 503", busy, 70, fetch_cap, 2),
        ("over window cap", "values: HTTP Error 503", busy, 156, window, 4),
        ("values 500", "values: HTTP Error 500", busy, 60, None, 0),
        ("diag refusal", "diag: HTTP Error 503", busy, 60, None, 0),
        ("status refusal", "status: HTTP Error 503", busy, 60, None, 0)):
    rejection = results[name]["rejection"] or ""
    check(not results[name]["passed"] and "live stress had errors: " in rejection and prefix in rejection,
          "UNEXPLAINED_REFUSAL_BLOCKS[" + name + "]: " + rejection)
    check("(" + marker + ") at +" + str(at) + ".00s, last uptime " in rejection and
          (reason is None or "; " + reason in rejection),
          "BLOCKING_REFUSAL_NAMES_TEXT_TIME_AND_REASON[" + name + "]: " + rejection)
    check(results[name]["firmware_weather"] == {"values": counted},
          "ONLY_EXPLAINED_REFUSALS_ARE_COUNTED[" + name + "]")
print(json.dumps({"checks": checks}))
`;

const run = (mode, file = gatePath) => spawnSync("python3", ["-I", "-B", "-c", probe, file, mode], {
  encoding: "utf8", timeout: 60_000, maxBuffer: 1024 * 1024,
});

const actual = run("actual");
assert.equal(actual.status, 0, `weather refusal probe failed: ${actual.stderr}`);
const { checks } = JSON.parse(actual.stdout);

// Negative control 1: a rule that explains everything must be caught by the scenarios.
const always = run("always-explained");
assert.notEqual(always.status, 0, "a rule that accepts every refusal must fail the probe");
assert.match(always.stderr, /UNEXPLAINED_REFUSAL_BLOCKS/);

// The accepted text must stay the firmware's own: a rename there would silently re-block the gate.
const source = fs.readFileSync(gatePath, "utf8");
const firmware = fs.readFileSync(path.join(root, "main/http_status.cpp"), "utf8");
const sent = firmware.match(
  /static esp_err_t network_tls_busy\(httpd_req_t\* req\) \{[^}]*?httpd_resp_sendstr\(req, "([^"]+)"\)/);
const accepted = source.match(/^WEATHER_TLS_BUSY_TEXT = "([^"]+)"$/m);
assert.ok(sent && accepted && sent[1] === accepted[1],
  "the gate's WEATHER_TLS_BUSY_TEXT must equal the firmware network_tls_busy body");

// Negative control 2: the previous behaviour (every /values 503 outside the window is an error at
// once) must be caught too. Seeded on a scratch copy of the real gate, never on the source.
const deferral = 'elif kind == "values" and error.code == 503:';
assert.equal(source.split(deferral).length, 2, "the deferral branch must exist exactly once");
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "weather-refusal-"));
try {
  const mutant = path.join(scratch, "gate.py");
  fs.writeFileSync(mutant, source.replace(deferral, "elif False:"));
  const immediate = run("actual", mutant);
  assert.notEqual(immediate.status, 0, "an immediate /values 503 error must fail the probe");
  assert.match(immediate.stderr, /EXPLAINED_REFUSAL_DOES_NOT_BLOCK/);
} finally {
  fs.rmSync(scratch, { recursive: true, force: true });
}
console.log(`OTA weather refusal contract passed (${checks} checks, two mutation controls)`);
