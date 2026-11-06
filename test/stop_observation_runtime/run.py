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
command = [*compiler, *flags, "-MMD", "-MF", str(dependencies), str(HERE / "fixture.cpp"),
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
         "fence_identity_scopes", "fence_scan_permutation", "finite_index_rebuild"]
results = []
for case in cases:
    result = subprocess.run([str(binary), case], cwd=ROOT, text=True, capture_output=True, timeout=30)
    (out / (case + ".txt")).write_text(result.stdout + result.stderr)
    results.append({"case": case, "returncode": result.returncode,
                    "stdout": result.stdout, "stderr": result.stderr})
    print(result.stdout + result.stderr, end="")
(out / "results.json").write_text(json.dumps(results, indent=2) + "\n")
if any(hashlib.sha256((ROOT / name).read_bytes()).hexdigest() != digest
       for name, digest in hashes.items()):
    raise SystemExit("Source changed while the runtime fixture was running")
print("Evidence:", out)
raise SystemExit(any(result["returncode"] for result in results))
