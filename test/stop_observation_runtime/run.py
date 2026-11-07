#!/usr/bin/env python3
"""Compile the real hourly store and run deterministic flash/clock/lock cases."""
from pathlib import Path
import argparse
import hashlib
import json
import os
import shlex
import subprocess
import tempfile

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--out", type=Path)
parser.add_argument("--sanitizer", choices=["none", "undefined"], default="none")
args = parser.parse_args()
out = args.out or Path(tempfile.mkdtemp(prefix="daikin-stop-observation-runtime-"))
out.mkdir(parents=True, exist_ok=True, mode=0o700)
history_path = ROOT / "main/history.cpp"
source = ROOT / "main/stop_observation_store.cpp"
source_sha_before = hashlib.sha256(source.read_bytes()).hexdigest()
history = history_path.read_text()
record_start = history.index("struct FlashJournalRecord {")
record_end = history.index("\nconst esp_partition_t* s_flash_part", record_start)
(out / "history_record.hpp").write_text(history[record_start:record_end])
reader_start = history.index("bool flash_read_stop_observation(")
reader_end = history.index("\n// Pass 1", reader_start)
(out / "history_reader.hpp").write_text(history[reader_start:reader_end])
flags = ["-std=c++17", "-O0", "-g", "-Wall", "-Wextra", "-Werror", "-I", str(out), "-I", str(HERE / "stubs"),
         "-I", str(ROOT / "main")]
if args.sanitizer == "undefined":
    flags += ["-fsanitize=undefined", "-fno-sanitize-recover=all"]
binary = out / "runtime"
compiler = shlex.split(os.environ.get("CXX", "c++"))
dependencies = out / "runtime.d"
command = [*compiler, *flags, "-MMD", "-MF", str(dependencies),
           "-DSTOP_OBSERVATION_PRODUCTION_SOURCE=" + json.dumps(str(source)), str(HERE / "fixture.cpp"),
           "-o", str(binary)]
compile_result = subprocess.run(command, cwd=ROOT, text=True, capture_output=True, timeout=120)
(out / "compile.txt").write_text(shlex.join(command) + "\n" + compile_result.stdout + compile_result.stderr)
if compile_result.returncode:
    raise SystemExit(compile_result.stderr)
inputs = {Path(__file__).resolve(), history_path}
for value in shlex.split(dependencies.read_text().replace("\\\n", " ").partition(":")[2]):
    path = Path(value)
    path = (path if path.is_absolute() else ROOT / path).resolve()
    if path in {out.resolve() / "history_record.hpp", out.resolve() / "history_reader.hpp"}:
        continue # their complete production source is bound above
    inputs.add(path)
hashes = {str(path.relative_to(ROOT)): hashlib.sha256(path.read_bytes()).hexdigest()
          for path in sorted(inputs)}
(out / "inputs.json").write_text(json.dumps(hashes, indent=2) + "\n")
(out / "compiler.txt").write_text(subprocess.run([*compiler, "--version"], text=True,
                                               capture_output=True, timeout=30).stdout)
cases = ["late_replay", "independent_clock", "busy_and_failure", "reset_and_consent", "restore_guards",
         "queue_and_saturation", "long_retention_and_expiry", "compatibility", "clock_and_undated",
         "reset_before_commit", "barrier_pressure_and_epoch", "identity_and_invalid_wire",
         "clock_lock_interleaves", "idle_clock_correction", "restored_loss_watermark",
         "reader_scratch_isolation", "aged_clock_fence", "future_clock_fence", "old_fence_capacity",
         "future_fence_late_merge", "indexed_fence_read_failure", "same_scope_fences", "fence_slot_reuse",
         "fence_geometry_wrap", "cold_fence_corruption", "data_loss_qualification", "future_base_late_merge",
         "fence_identity_scopes", "fence_scan_permutation", "finite_index_rebuild", "early_forget",
         "forget_lifecycle", "forget_allocation_failure", "first_mutex_publication",
         "first_mutex_take_failure", "forget_before_create", "forget_after_create", "forget_first_take",
         "forget_busy_store", "forget_waiting_getter", "forget_getter_final", "forget_getter_invalid_clock",
         "forget_staged_restore", "forget_claimed_receipt", "forget_claim_merge", "forget_cold_boot"]
results = []
for case in cases:
    result = subprocess.run([str(binary), case], cwd=ROOT, text=True, capture_output=True, timeout=30)
    (out / (case + ".txt")).write_text(result.stdout + result.stderr)
    results.append({"case": case, "returncode": result.returncode,
                    "stdout": result.stdout, "stderr": result.stderr})
    print(result.stdout + result.stderr, end="")
(out / "results.json").write_text(json.dumps(results, indent=2) + "\n")
negative_controls = []
if not any(result["returncode"] for result in results):
    production = source.read_text()
    latch = "    s_forgotten.store(true, std::memory_order_release);\n"
    start = "void stop_observation_start(bool enabled, uint32_t consent_generation) {\n"
    first_lock = "    SemGuard lk(mutex);\n"
    for anchor in (latch, start, first_lock):
        if production.count(anchor) != 1:
            raise RuntimeError("Expected one forget/publication mutation anchor: " + anchor)
    mutations = [
        ("omit_early_forget_latch", production.replace(latch, ""), "early_forget",
         "early forget suppresses same-boot late start and new evidence"),
        ("clear_forget_latch_on_start",
         production.replace(start, start + "    s_forgotten.store(false, std::memory_order_release);\n"),
         "early_forget", "early forget suppresses same-boot late start and new evidence"),
        ("publish_mutex_before_initialization",
         production.replace(first_lock, "    s_mutex.store(mutex, std::memory_order_release);\n" + first_lock),
         "first_mutex_publication", "first mutex stays unpublished until protected state initialized"),
    ]
    for name, text, case, oracle in mutations:
        mutant = out / (name + ".cpp")
        mutant.write_text(text)
        executable = out / name
        argv = [*compiler, *flags,
                "-DSTOP_OBSERVATION_PRODUCTION_SOURCE=" + json.dumps(str(mutant)),
                str(HERE / "fixture.cpp"), "-o", str(executable)]
        build = subprocess.run(argv, cwd=ROOT, text=True, capture_output=True, timeout=120)
        (out / (name + "-compile.txt")).write_text(shlex.join(argv) + "\n" + build.stdout + build.stderr)
        if build.returncode:
            raise RuntimeError("Negative control did not compile: " + name + "\n" + build.stderr)
        result = subprocess.run([str(executable), case], cwd=ROOT, text=True,
                                capture_output=True, timeout=30)
        (out / (name + ".txt")).write_text(result.stdout + result.stderr)
        if result.returncode != 1 or "FAIL " + case + ": " + oracle not in result.stderr:
            raise RuntimeError("Negative control missed its semantic oracle: " + name + "\n" +
                               result.stdout + result.stderr)
        negative_controls.append({"name": name, "case": case, "oracle": oracle,
                                  "returncode": result.returncode, "stdout": result.stdout,
                                  "stderr": result.stderr,
                                  "mutant_sha256": hashlib.sha256(mutant.read_bytes()).hexdigest()})
        print("DETECTED " + name + " " + result.stderr.strip())
if any(hashlib.sha256((ROOT / name).read_bytes()).hexdigest() != digest
       for name, digest in hashes.items()):
    raise SystemExit("Source changed while the runtime fixture was running")
if hashlib.sha256(source.read_bytes()).hexdigest() != source_sha_before:
    raise SystemExit("Production changed during compilation or execution")
receipt = {"outcome": "passed" if not any(result["returncode"] for result in results) else "failed",
           "sanitizer": args.sanitizer, "standard": "c++17", "production_body_rewrite": False,
           "source_sha256": source_sha_before, "inputs_unchanged": True,
           "input_sha256": hashes, "cases": results, "negative_controls": negative_controls,
           "limits": ["Deterministic SDK/flash transport ports model task interleavings; no kernel race or hardware proof.",
                      "Fresh host process observes production static initialization; no physical cold boot or latch clear API."]}
(out / "receipt.json").write_text(json.dumps(receipt, indent=2) + "\n")
print("Evidence:", out)
raise SystemExit(any(result["returncode"] for result in results))
