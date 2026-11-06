#!/usr/bin/env python3
"""Run complete production History + StopStore with local SDK/NOR transport ports."""
import argparse
import datetime
import hashlib
import json
from pathlib import Path
import shlex
import subprocess
import tempfile

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
SOURCE = ROOT / "main/history.cpp"
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--out", type=Path)
parser.add_argument("--sanitizer", choices=["none", "undefined"], default="undefined")
parser.add_argument("--expect-red", action="store_true")
args = parser.parse_args()
if args.out:
    OUT = args.out.resolve()
    OUT.mkdir(parents=True, mode=0o700, exist_ok=False)
else:
    OUT = Path(tempfile.mkdtemp(prefix="daikin-history-journal-runtime-"))
compiler = ["c++"]
flags = ["-std=c++17", "-O0", "-g", "-fno-omit-frame-pointer", "-Wall", "-Wextra",
         "-I", str(HERE / "stubs"), "-I", str(ROOT / "main")]
if args.sanitizer == "undefined":
    flags += ["-fsanitize=undefined", "-fno-sanitize-recover=all"]
commands = []


def run(argv, timeout=90):
    commands.append(shlex.join([str(value) for value in argv]))
    (OUT / "commands.json").write_text(json.dumps(commands, indent=2) + "\n")
    return subprocess.run(argv, cwd=ROOT, text=True, capture_output=True, timeout=timeout)


def checked(argv):
    result = run(argv)
    if result.returncode:
        raise RuntimeError(result.stdout + result.stderr)
    return result.stdout


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


version = checked([*compiler, "--version"])
sources = [HERE / "fixture.cpp", ROOT / "main/stop_observation_store.cpp"]
inputs = {Path(__file__).resolve(), SOURCE}
inputs.add(HERE / "README.md")
for index, source in enumerate(sources):
    dependency = OUT / f"preflight-{index}.d"
    checked([*compiler, *flags, "-MM", "-MF", str(dependency),
             "-DHISTORY_PRODUCTION_SOURCE=" + json.dumps(str(SOURCE)), str(source)])
    words = shlex.split(dependency.read_text().replace("\\\n", " ").partition(":")[2])
    inputs.update((Path(value) if Path(value).is_absolute() else ROOT / value).resolve()
                  for value in words)
hashes = {str(path.relative_to(ROOT)): digest(path) for path in sorted(inputs)}
(OUT / "inputs.json").write_text(json.dumps(hashes, indent=2) + "\n")
(OUT / "history-production-baseline.cpp").write_bytes(SOURCE.read_bytes())
(OUT / "stop-store-production-baseline.cpp").write_bytes(sources[1].read_bytes())
(OUT / "observation-hourly-baseline.hpp").write_bytes(
    (ROOT / "main/logic/observation_hourly.hpp").read_bytes())
results = []
mutants = []


def build(source, name):
    objects = []
    for index, translation_unit in enumerate(sources):
        obj = OUT / f"{name}-{index}.o"
        result = run([*compiler, *flags, "-MMD", "-MF", str(OUT / f"{name}-{index}.d"),
                      "-DHISTORY_PRODUCTION_SOURCE=" + json.dumps(str(source)), "-c",
                      str(translation_unit), "-o", str(obj)], timeout=120)
        (OUT / f"{name}-{index}.compile.txt").write_text(
            commands[-1] + "\n" + result.stdout + result.stderr)
        if result.returncode:
            raise RuntimeError("Compilation failed: " + name + "\n" + result.stdout + result.stderr)
        objects.append(obj)
    binary = OUT / name
    checked([*compiler, *flags, *(str(path) for path in objects), "-o", str(binary)])
    return binary


def execute(binary, case, label):
    result = run([str(binary), case])
    (OUT / (label + ".stdout.txt")).write_text(result.stdout)
    (OUT / (label + ".stderr.txt")).write_text(result.stderr)
    return result


def oracle_failed(result, case, oracle):
    return result.returncode == 1 and (
        "FAIL oracle=" + oracle + " case=" + case + " ") in result.stdout and not result.stderr


baseline = build(SOURCE, "baseline")
phases = ["prepare_read", "prepare_erase", "body", "commit", "readback",
          "commit_accepted_error", "success"]
cases = ["commit_rejected", "core_ahead", "nor_contract", "read_admission"] + [
    kind + "_" + phase for kind in ["data", "barrier"] for phase in phases]
if args.expect_red:
    cases = ["commit_rejected"]
for case in cases:
    result = execute(baseline, case, case)
    expected = oracle_failed(result, case, "failed_append_releases_claim_for_real_service_retry") \
        if args.expect_red else result.returncode == 0 and "PASS case=" + case + " " in result.stdout
    results.append({"case": case, "exit_code": result.returncode,
                    "stdout": result.stdout, "stderr": result.stderr, "pass": expected})
    print(result.stdout, end="", flush=True)
    if not expected:
        (OUT / "failure.json").write_text(json.dumps(results[-1], indent=2) + "\n")
        raise RuntimeError("Unexpected semantic outcome: " + case)
unknowns = []
for case in ["unknown_case", "data_unknown", "barrier_unknown"]:
    result = execute(baseline, case, case)
    ok = oracle_failed(result, case, "unknown_case")
    unknowns.append({"case": case, "pass": ok})
    if not ok:
        raise RuntimeError("Unknown-case guard failed: " + case)

if not args.expect_red:
    text = SOURCE.read_text()
    mutations = [
        ("omit_failure_callback", "        if (stop_owned) stop_observation_flash_failed();",
         "        (void)stop_owned;", ["data_commit", "barrier_commit"],
         "failed_append_releases_claim_for_real_service_retry"),
        ("old_read_classifier", "const bool      stop_owned = logic::observation_append_owned(r.header);",
         "const bool      stop_owned = logic::observation_header_matches(r.header);",
         ["data_commit", "barrier_commit"], "failed_append_releases_claim_for_real_service_retry"),
        ("clear_core_ahead_on_stop_success", "if (!flash_is_manifest(r.header) && !stop_owned)",
         "if (!flash_is_manifest(r.header))", ["core_ahead"],
         "stop_success_preserves_core_ahead_episode"),
        ("trust_write_error_over_valid_readback",
         "const bool committed = read_e == ESP_OK && flash_record_physically_valid(verify) &&",
         "const bool committed = e == ESP_OK && read_e == ESP_OK && flash_record_physically_valid(verify) &&",
         ["data_commit_accepted_error", "barrier_commit_accepted_error"],
         "verified_readback_is_commit_authority"),
    ]
    for name, before, after, controls, oracle in mutations:
        if text.count(before) != 1:
            raise RuntimeError("Expected one mutation anchor: " + name)
        source = OUT / (name + ".cpp")
        source.write_text(text.replace(before, after, 1))
        binary = build(source, name)
        for case in controls:
            result = execute(binary, case, name + "-" + case)
            ok = oracle_failed(result, case, oracle)
            mutants.append({"mutation": name, "case": case, "compiled": True,
                            "oracle": oracle, "stdout": result.stdout,
                            "stderr": result.stderr, "exit_code": result.returncode,
                            "binary_sha256": digest(binary), "pass": ok})
            if not ok:
                (OUT / "mutation-failure.json").write_text(json.dumps(mutants[-1], indent=2) + "\n")
                raise RuntimeError("Mutation escaped named semantic oracle: " + name + " " + case)
            print("PASS compiling control=" + name + " case=" + case, flush=True)

unchanged = all(digest(ROOT / name) == value for name, value in hashes.items())
receipt = {"utc": datetime.datetime.now(datetime.timezone.utc).isoformat(),
           "compiler": version, "sanitizer": args.sanitizer,
           "whole_history_translation_unit": True, "real_stop_store": True,
           "baseline_production_body_rewrite": False, "expected_red": args.expect_red,
           "source_hashes": hashes, "baseline_binary_sha256": digest(baseline),
           "cases": results, "compiling_controls": mutants, "unknown_guards": unknowns,
           "inputs_unchanged": unchanged,
           "pass": unchanged and all(r["pass"] for r in results + mutants + unknowns)}
(OUT / "receipt.json").write_text(json.dumps(receipt, indent=2) + "\n")
if not receipt["pass"]:
    raise RuntimeError("Runtime inputs changed or an oracle failed")
print("EXPECTED_RED retained" if args.expect_red else
      f"PASS {len(results)} cases / {len(mutations)} compiling mutants / {len(mutants)} mutation oracles")
