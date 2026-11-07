#!/usr/bin/env python3
"""Run complete production History + StopStore with local SDK/NOR transport ports."""
import argparse
import datetime
import hashlib
import json
from pathlib import Path
import re
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
parser.add_argument("--expect-red-case", choices=["claim", "late-correction"], default="claim")
args = parser.parse_args()
if args.expect_red_case != "claim" and not args.expect_red:
    parser.error("--expect-red-case requires --expect-red")
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


dependency_target = "history-journal-runtime"


def dependency_paths(path):
    line = path.read_text().replace("\\\n", " ").strip()
    target, separator, names = line.partition(":")
    if target != dependency_target or not separator or not names or "\n" in names:
        raise RuntimeError("Invalid or empty compiler dependency file: " + str(path))
    # Make escapes spaces and hashes, while apostrophes are literal path characters.
    words = re.findall(r"(?:\\[ \t#\\]|[^\s])+", names)
    return {(ROOT / re.sub(r"\\([ \t#\\])", r"\1", word).replace("$$", "$")).resolve(strict=True)
            for word in words}


def verify_hashes(expected, label):
    for path, sha in expected.items():
        if digest(path) != sha:
            raise RuntimeError(f"Compiler input changed during {label}: {path}")


version = checked([*compiler, "--version"])
sources = [HERE / "fixture.cpp", ROOT / "main/stop_observation_store.cpp"]
preflight_dependencies = []
for index, source in enumerate(sources):
    dependency = OUT / f"preflight-{index}.d"
    checked([*compiler, *flags, "-MM", "-MF", str(dependency), "-MT", dependency_target,
             "-DHISTORY_PRODUCTION_SOURCE=" + json.dumps(str(SOURCE)), str(source)])
    paths = dependency_paths(dependency)
    if source not in paths:
        raise RuntimeError("Compiler preflight omitted its translation unit: " + str(source))
    preflight_dependencies.append(paths)
if SOURCE not in preflight_dependencies[0] or SOURCE in preflight_dependencies[1]:
    raise RuntimeError("Compiler preflight did not bind History only through the fixture")
inputs = {Path(__file__).resolve(), HERE / "README.md"}.union(*preflight_dependencies)
input_hashes = {path: digest(path) for path in sorted(inputs)}
hashes = {str(path.relative_to(ROOT)): sha for path, sha in input_hashes.items()}
(OUT / "inputs.json").write_text(json.dumps(hashes, indent=2) + "\n")
(OUT / "history-production-baseline.cpp").write_bytes(SOURCE.read_bytes())
(OUT / "stop-store-production-baseline.cpp").write_bytes(sources[1].read_bytes())
(OUT / "observation-hourly-baseline.hpp").write_bytes(
    (ROOT / "main/logic/observation_hourly.hpp").read_bytes())
(OUT / "history-persist-baseline.hpp").write_bytes(
    (ROOT / "main/logic/history_persist.hpp").read_bytes())
results = []
mutants = []
dependency_checks = {}
mutation_hashes = {}


def build(source, name):
    expected_deps = [
        {source if path == SOURCE else path for path in paths} for paths in preflight_dependencies
    ]
    if source != SOURCE:
        mutation_hashes[source] = digest(source)
    expected_hashes = {path: input_hashes[path] for path in inputs if path != SOURCE or source == SOURCE}
    if source != SOURCE:
        expected_hashes[source] = mutation_hashes[source]
    verify_hashes(expected_hashes, name + " pre-compile")
    objects = []
    compiled_deps = []
    for index, (translation_unit, expected) in enumerate(zip(sources, expected_deps)):
        obj = OUT / f"{name}-{index}.o"
        dependency = OUT / f"{name}-{index}.d"
        result = run([*compiler, *flags, "-MMD", "-MF", str(dependency), "-MT", dependency_target,
                      "-DHISTORY_PRODUCTION_SOURCE=" + json.dumps(str(source)), "-c",
                      str(translation_unit), "-o", str(obj)], timeout=120)
        (OUT / f"{name}-{index}.compile.txt").write_text(
            commands[-1] + "\n" + result.stdout + result.stderr)
        if result.returncode:
            raise RuntimeError("Compilation failed: " + name + "\n" + result.stdout + result.stderr)
        actual = dependency_paths(dependency)
        if actual != expected:
            missing = sorted(str(path) for path in expected - actual)
            unexpected = sorted(str(path) for path in actual - expected)
            raise RuntimeError(f"Compiler dependency mismatch for {name}-{index}: "
                               f"missing={missing}, unexpected={unexpected}")
        verify_hashes(expected_hashes, f"{name}-{index} compile")
        compiled_deps.append({"mmd": dependency.name, "sha256": digest(dependency),
                              "paths": sorted(str(path) for path in actual)})
        objects.append(obj)
    binary = OUT / name
    checked([*compiler, *flags, *(str(path) for path in objects), "-o", str(binary)])
    verify_hashes(expected_hashes, name + " link")
    dependency_checks[name] = {"history_source": str(source),
                               "history_source_sha256": expected_hashes[source],
                               "translation_units": compiled_deps}
    return binary


def execute(binary, case, label, extra=()):
    result = run([str(binary), case, *(str(value) for value in extra)])
    (OUT / (label + ".stdout.txt")).write_text(result.stdout)
    (OUT / (label + ".stderr.txt")).write_text(result.stderr)
    return result


def oracle_failed(result, case, oracle):
    return result.returncode == 1 and (
        "FAIL oracle=" + oracle + " case=" + case + " ") in result.stdout and not result.stderr


baseline = build(SOURCE, "baseline")
phases = ["prepare_read", "prepare_erase", "body", "commit", "readback",
          "commit_accepted_error", "success"]
cases = ["commit_rejected", "core_ahead", "nor_contract", "read_admission", "sequence_rejections",
         "core_sequence_prepare", "core_sequence_readback", "core_sequence_commit_error",
         "forget_before_start", "forget_during_lookup", "forget_during_scan",
         "forget_missing_partition", "forget_wrong_address", "forget_wrong_size",
         "forget_missing_history_mutex", "forget_missing_flash_mutex", "forget_ready",
         "forget_incomplete_scan"] + [
    kind + "_" + phase for kind in ["data", "barrier"] for phase in phases]
if args.expect_red:
    cases = ["commit_rejected"] if args.expect_red_case == "claim" else []
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
transport_evidence = []
pending_cases = ["checkup_pending_healthy", "checkup_pending_forget"]
if not args.expect_red or args.expect_red_case == "late-correction":
    transport = OUT / "late-correction.synthetic-nor.bin"
    paired_cases = ["seed_late_correction", "restore_late_correction"]
    for case in paired_cases + ([] if args.expect_red else pending_cases):
        result = execute(baseline, case, case, [transport])
        expected_failure = args.expect_red and case == "restore_late_correction"
        expected = oracle_failed(result, case, "fresh_restore_retains_acknowledged_late_correction") \
            if expected_failure else result.returncode == 0 and "PASS case=" + case + " " in result.stdout
        results.append({"case": case, "exit_code": result.returncode,
                        "stdout": result.stdout, "stderr": result.stderr,
                        "expected_red": expected_failure, "pass": expected})
        print(result.stdout, end="", flush=True)
        if not expected:
            (OUT / "failure.json").write_text(json.dumps(results[-1], indent=2) + "\n")
            raise RuntimeError("Unexpected paired-process semantic outcome: " + case)
    transport_evidence.append({"path": str(transport), "sha256": digest(transport),
                               "bytes": transport.stat().st_size,
                               "only_cross_process_state": "synthetic NOR partition bytes"})
unknowns = []
for case in ["unknown_case", "data_unknown", "barrier_unknown",
             "seed_late_correction", "restore_late_correction"]:
    result = execute(baseline, case, case)
    ok = oracle_failed(result, case, "unknown_case")
    unknowns.append({"case": case, "pass": ok})
    if not ok:
        raise RuntimeError("Unknown-case guard failed: " + case)

if not args.expect_red:
    text = SOURCE.read_text()
    forget_start = text.index("bool history_flash_forget()")
    forget_end = text.index("\nstatic void history_flash_start()", forget_start)
    forget_body = text[forget_start:forget_end]
    ready_check = "    if (!s_flash_forget_ready.load(std::memory_order_acquire)) return false;\n"
    erase_lock = "    Lock flash_lk(s_flash_mtx);\n"
    if forget_body.count(ready_check) != 1 or forget_body.count(erase_lock) != 1:
        raise RuntimeError("Expected one Forget readiness check and flash lock")
    old_forget = forget_body.replace(ready_check, "").replace(
        erase_lock, "    if (!s_flash_part) return wipe_ram_and_index();\n"
        "    if (!s_flash_mtx) return false;\n" + erase_lock)
    readiness_publication = "    if (s_mtx) s_flash_forget_ready.store(true, std::memory_order_release);"
    startup_scan = "    s_flash_scan_ok = flash_journal_scan();"
    pending_start = text.index("bool history_checkup_flash_pending()")
    pending_end = text.index("\n\n", pending_start)
    pending_body = text[pending_start:pending_end]
    old_pending = ("bool history_checkup_flash_pending() {\n"
                   "    return s_flash_part && s_flash_scan_ok && !s_flash_checkup_restore_done;\n"
                   "}")
    pre_lock = "    if (s_flash_forgotten.load()) return false;\n"
    under_lock = "flash_lk.acquired() && !s_flash_forgotten.load() && s_flash_scan_ok"
    if pending_body.count(pre_lock) != 1 or pending_body.count(under_lock) != 1:
        raise RuntimeError("Expected both pending query Forget checks")
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
        ("treat_null_partition_as_erased", forget_body, old_forget,
         ["forget_during_lookup", "forget_missing_partition", "forget_wrong_address",
          "forget_wrong_size", "forget_missing_flash_mutex"], "unready_forget_refuses"),
        ("publish_erase_ready_before_scan", startup_scan,
         readiness_publication + "\n" + startup_scan, ["forget_during_scan"],
         "unready_forget_refuses"),
        ("publish_erase_ready_without_history_mutex", readiness_publication,
         "    s_flash_forget_ready.store(true, std::memory_order_release);",
         ["forget_missing_history_mutex"], "unready_forget_preserves_nor"),
        ("report_forget_without_erase", "e = esp_partition_erase_range(s_flash_part, 0, s_flash_part->size);",
         "e = ESP_OK;", ["forget_ready", "forget_incomplete_scan"],
         "successful_forget_erases_entire_journal"),
        ("query_pending_without_lock", pending_body, old_pending, ["checkup_pending_healthy"],
         "contended_pending_query_is_nonblocking"),
        ("query_pending_without_forget_recheck", pending_body,
         pending_body.replace(under_lock, "flash_lk.acquired() && s_flash_scan_ok"),
         ["checkup_pending_forget"], "pending_rechecks_forget_under_lock"),
        ("query_pending_without_forget_fast_path", pending_body, pending_body.replace(pre_lock, ""),
         ["checkup_pending_forget"], "already_forgotten_pending_skips_lock"),
    ]
    for name, before, after, controls, oracle in mutations:
        if text.count(before) != 1:
            raise RuntimeError("Expected one mutation anchor: " + name)
        source = OUT / (name + ".cpp")
        source.write_text(text.replace(before, after, 1))
        binary = build(source, name)
        for case in controls:
            result = execute(binary, case, name + "-" + case,
                             [transport] if case in pending_cases else [])
            ok = oracle_failed(result, case, oracle)
            mutants.append({"mutation": name, "case": case, "compiled": True,
                            "oracle": oracle, "stdout": result.stdout,
                            "stderr": result.stderr, "exit_code": result.returncode,
                            "binary_sha256": digest(binary), "pass": ok})
            if not ok:
                (OUT / "mutation-failure.json").write_text(json.dumps(mutants[-1], indent=2) + "\n")
                raise RuntimeError("Mutation escaped named semantic oracle: " + name + " " + case)
            print("PASS compiling control=" + name + " case=" + case, flush=True)

    # Undo only reservation timing, restoring the old success-only sequence increment. The
    # paired seed must still pass; its fresh process must lose the acknowledged late correction.
    name = "reuse_sequence_until_verified_success"
    reserve = "    if (!logic::history_journal_reserve_sequence(s_flash_next_sequence, r.header.sequence))\n" \
              "        return ESP_ERR_INVALID_ARG;\n"
    success = "    s_flash_next_slot = (slot + 1) % logic::HISTORY_JOURNAL_SLOT_COUNT;\n"
    if text.count(reserve) != 1 or text.count(success) != 1:
        raise RuntimeError("Expected unique sequence timing mutation anchors")
    source = OUT / (name + ".cpp")
    source.write_text(text.replace(reserve, "", 1).replace(
        success, success + "    s_flash_next_sequence++;\n", 1))
    binary = build(source, name)
    mutations.append((name,))
    for case in ["data_commit", "barrier_commit", "core_sequence_readback"]:
        result = execute(binary, case, name + "-" + case)
        oracle = "every_append_attempt_consumes_one_sequence"
        ok = oracle_failed(result, case, oracle)
        mutants.append({"mutation": name, "case": case, "compiled": True, "oracle": oracle,
                        "stdout": result.stdout, "stderr": result.stderr,
                        "exit_code": result.returncode, "binary_sha256": digest(binary), "pass": ok})
        if not ok:
            raise RuntimeError("Sequence timing mutation escaped generic source oracle: " + case)
        print("PASS compiling control=" + name + " case=" + case, flush=True)
    transport = OUT / (name + ".synthetic-nor.bin")
    seed = execute(binary, "seed_late_correction", name + "-seed", [transport])
    if seed.returncode or "PASS case=seed_late_correction " not in seed.stdout or seed.stderr:
        raise RuntimeError("Sequence mutation paired seed failed before the cold-restore oracle")
    case = "restore_late_correction"
    result = execute(binary, case, name + "-restore", [transport])
    oracle = "fresh_restore_retains_acknowledged_late_correction"
    ok = oracle_failed(result, case, oracle)
    mutants.append({"mutation": name, "case": case, "compiled": True, "oracle": oracle,
                    "seed_stdout": seed.stdout, "stdout": result.stdout, "stderr": result.stderr,
                    "exit_code": result.returncode, "binary_sha256": digest(binary), "pass": ok})
    transport_evidence.append({"path": str(transport), "sha256": digest(transport),
                               "bytes": transport.stat().st_size, "mutation": name,
                               "only_cross_process_state": "synthetic NOR partition bytes"})
    if not ok:
        raise RuntimeError("Sequence mutation escaped fresh-process acknowledged-population oracle")
    print("PASS compiling control=" + name + " case=" + case, flush=True)

unchanged = all(digest(path) == value
                for path, value in (input_hashes | mutation_hashes).items())
receipt = {"utc": datetime.datetime.now(datetime.timezone.utc).isoformat(),
           "compiler": version, "sanitizer": args.sanitizer,
           "whole_history_translation_unit": True, "real_stop_store": True,
           "baseline_production_body_rewrite": False, "expected_red": args.expect_red,
           "expected_red_case": args.expect_red_case if args.expect_red else None,
           "source_hashes": hashes, "baseline_binary_sha256": digest(baseline),
           "preflight_dependencies": [sorted(str(path) for path in paths)
                                      for paths in preflight_dependencies],
           "compile_dependency_checks": dependency_checks,
           "cases": results, "compiling_controls": mutants, "unknown_guards": unknowns,
           "transport_evidence": transport_evidence,
           "inputs_unchanged": unchanged,
           "pass": unchanged and all(r["pass"] for r in results + mutants + unknowns)}
(OUT / "receipt.json").write_text(json.dumps(receipt, indent=2) + "\n")
if not receipt["pass"]:
    raise RuntimeError("Runtime inputs changed or an oracle failed")
print("EXPECTED_RED retained" if args.expect_red else
      f"PASS {len(results)} cases / {len(mutations)} compiling mutants / {len(mutants)} mutation oracles")
