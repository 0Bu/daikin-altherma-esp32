#!/usr/bin/env python3
"""Compile the actual HYDR store with SDK ports and retain source-bound runtime evidence."""
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
production_source = ROOT / "main/hydronic_observation_store.cpp"
source_sha_before = hashlib.sha256(production_source.read_bytes()).hexdigest()
codec_source = ROOT / "main/logic/hydronic_hourly.hpp"
codec_sha_before = hashlib.sha256(codec_source.read_bytes()).hexdigest()
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--out", type=Path)
parser.add_argument("--sanitizer", choices=["none", "undefined"], default="none")
args = parser.parse_args()
out = args.out or Path(tempfile.mkdtemp(prefix="daikin-hydronic-runtime-"))
out.mkdir(parents=True, exist_ok=True, mode=0o700)
flags = ["-std=c++17", "-O0", "-g", "-Wall", "-Wextra", "-Werror", "-I", str(HERE / "stubs"),
         "-I", str(ROOT / "main")]
if args.sanitizer == "undefined":
    flags += ["-fsanitize=undefined", "-fno-sanitize-recover=all"]
binary = out / "runtime"
compiler = shlex.split(os.environ.get("CXX", "c++"))
dependencies = out / "runtime.d"
command = [*compiler, *flags, "-MMD", "-MF", str(dependencies), str(HERE / "fixture.cpp"),
           "-o", str(binary)]
compiled = subprocess.run(command, cwd=ROOT, text=True, capture_output=True, timeout=120)
(out / "compile.txt").write_text(shlex.join(command) + "\n" + compiled.stdout + compiled.stderr)
if compiled.returncode:
    raise SystemExit(compiled.stderr)
inputs = {Path(__file__).resolve()}
for value in shlex.split(dependencies.read_text().replace("\\\n", " ").partition(":")[2]):
    path = Path(value)
    inputs.add((path if path.is_absolute() else ROOT / path).resolve())
hashes = {str(path.relative_to(ROOT)): hashlib.sha256(path.read_bytes()).hexdigest()
          for path in sorted(inputs)}
(out / "inputs.json").write_text(json.dumps(hashes, indent=2) + "\n")
(out / "compiler.txt").write_text(subprocess.run([*compiler, "--version"], text=True,
                                               capture_output=True, timeout=30).stdout)
cases = ["codec", "settling_durations", "seam_and_revisions", "restore_and_identity", "reset_and_claims",
         "overlapping_archive_fragment", "overlap_shutdown_drain", "disjoint_earlier_archive_fragment",
         "shared_duration_archive_report", "shared_duration_archive_append", "sample_only_archive_edge",
         "sample_only_newer_archive_edge", "between_archived_hours", "future_archive_due",
         "future_bucket_due", "future_boundary_during_rebuild",
         "saturated_sample_edge",
         "queue_loss", "expiry", "archive_clock_rollback", "archive_clock_rollback_live",
         "clock", "receipts", "fences_and_index", "forget_and_seal",
         "wide_totals", "reader_races", "invalid_deltas", "read_failures", "reset_before_commit",
         "early_forget", "creation_forget", "creation_publish", "failed_creation_forget",
         "staging_forget", "claim_forget", "index_reset_before_start", "index_record_before_start",
         "index_incomplete_before_start", "index_service_before_start", "index_next_before_start",
         "index_producer_ownership", "index_suppressed_no_init", "index_suppressed_existing_reset",
         "inactive_startup_paths", "inactive_failed_create_recovery", "inactive_failed_take_recovery",
         "inactive_publication", "inactive_partial_reader", "inactive_staged_reset", "inactive_staged_forget"]
results = []
for case in cases:
    result = subprocess.run([str(binary), case], cwd=ROOT, text=True, capture_output=True, timeout=30)
    (out / (case + ".txt")).write_text(result.stdout + result.stderr)
    results.append({"case": case, "returncode": result.returncode,
                    "stdout": result.stdout, "stderr": result.stderr})
    print(result.stdout + result.stderr, end="")
(out / "results.json").write_text(json.dumps(results, indent=2) + "\n")
store_source = (ROOT / "main/hydronic_observation_store.cpp").read_text()
fixture_source = (HERE / "fixture.cpp").read_text()
negative_controls = [
    ("forget_latch", "early_forget",
     "    s_forget_latched.store(true, std::memory_order_release);",
     "    // Negative control: discard the per-boot forget intent.",
     "Start and Bind cannot reactivate after pre-start forget"),
    ("early_publication", "creation_publish",
     "    SemGuard lk(mutex);",
     "    s_mutex.store(mutex, std::memory_order_release);\n    SemGuard lk(mutex);",
     "reader must not see a handle published before Store initialization"),
    ("omit_startup_defaults", "inactive_startup_paths",
     "    clear_live();\n    s_identity                    = {};",
     "    // Negative control: publish without canonical live defaults.\n    s_identity                    = {};",
     "Start installs canonical active defaults before the first queued append"),
    ("report_overlap", "overlapping_archive_fragment",
     "    return before || after;",
     "    static_cast<void>(before);\n    static_cast<void>(after);\n    return true;",
     "live overlap is withheld rather than counted with the archive"),
    ("retry_permanent_overlap", "overlapping_archive_fragment",
     "            finish_transaction(ReceiptResult::Rejected);\n            continue;",
     "            finish_transaction(ReceiptResult::Retry);\n            continue;",
     "conflicting fragment retires once while the valid archive remains readable"),
    ("halt_after_rejected_head", "overlap_shutdown_drain",
     "            finish_transaction(ReceiptResult::Rejected);\n            continue;",
     "            finish_transaction(ReceiptResult::Rejected);\n            return false;",
     "later queued evidence drains in the same turn as a rejected head"),
    ("retry_invalid_merge_base", "read_failures",
     "            if (result == HydronicReadResult::Retry) {\n"
     "                hydronic_observation_flash_failed();",
     "            if (result != HydronicReadResult::Valid) {\n"
     "                hydronic_observation_flash_failed();",
     "invalid base retires one revision and allows a later hour without replacing flash"),
    ("withhold_disjoint_earlier", "disjoint_earlier_archive_fragment",
     "    return before || after;",
     "    static_cast<void>(before);\n    return after;",
     "provably earlier disjoint live evidence remains visible with the archive"),
    ("extend_before_sample_admission", "saturated_sample_edge",
     "    if (d.accepted) {\n        if (s_open_bucket == observation_bucket(at) && s_open.samples == UINT32_MAX) {",
     "    if (d.accepted) {\n        open_at(at, at, 0);\n"
     "        if (s_open_bucket == observation_bucket(at) && s_open.samples == UINT32_MAX) {",
     "rejected saturated point does not extend evidence"),
]
negative_results = []


def compile_control(name, store, codec=None):
    codec_sha = None
    if codec is not None:
        mutant_codec = out / f"negative-{name}-codec.hpp"
        mutant_codec.write_text(codec)
        codec_sha = hashlib.sha256(mutant_codec.read_bytes()).hexdigest()
        store_header = out / f"negative-{name}-store.hpp"
        store_header.write_text((ROOT / "main/hydronic_observation_store.hpp").read_text().replace(
            '"logic/hydronic_hourly.hpp"', f'"{mutant_codec.name}"', 1))
        store = store.replace('"hydronic_observation_store.hpp"', f'"{store_header.name}"', 1)
    mutant_source = out / f"negative-{name}.cpp"
    mutant_source.write_text(store)
    mutant_fixture = out / f"negative-{name}-fixture.cpp"
    mutant_fixture.write_text(fixture_source.replace('#include "hydronic_observation_store.cpp"',
                                                    f'#include "{mutant_source.name}"', 1))
    mutant_binary = out / f"negative-{name}"
    mutant_command = [*compiler, *flags, "-MMD", "-MF", str(out / f"negative-{name}.d"),
                      str(mutant_fixture), "-o", str(mutant_binary)]
    compile_result = subprocess.run(mutant_command, cwd=ROOT, text=True, capture_output=True,
                                    timeout=120)
    (out / f"negative-{name}-compile.txt").write_text(shlex.join(mutant_command) + "\n" +
                                                    compile_result.stdout + compile_result.stderr)
    if compile_result.returncode:
        raise SystemExit(f"Negative control {name} must compile:\n{compile_result.stderr}")
    return mutant_binary, hashlib.sha256(mutant_source.read_bytes()).hexdigest(), codec_sha


def check_control(name, case, oracle, compiled_control):
    mutant_binary, store_sha, codec_sha = compiled_control
    result = subprocess.run([str(mutant_binary), case], cwd=ROOT, text=True, capture_output=True,
                            timeout=30)
    rejected = result.returncode == 1 and result.stderr.strip().endswith(": " + oracle)
    negative_results.append({"name": name, "case": case, "returncode": result.returncode,
                             "expected_oracle": oracle, "semantic_failure_observed": rejected,
                             "source_sha256": store_sha, "mutant_codec_sha256": codec_sha,
                             "stdout": result.stdout, "stderr": result.stderr})
    (out / f"negative-{name}-{case}.txt").write_text(result.stdout + result.stderr)
    print(f"negative_{name}/{case}: compiled; " +
          ("expected semantic failure observed" if rejected else "FAILED to reject mutation"))


for name, case, needle, replacement, oracle in negative_controls:
    if store_source.count(needle) != 1:
        raise SystemExit(f"Negative control {name}: production mutation point changed")
    check_control(name, case, oracle, compile_control(name, store_source.replace(needle, replacement, 1)))

archive_span_start = store_source.index("bool outside_archive_span(")
archive_span_body = store_source.index("{", archive_span_start) + 1
archive_span_end = store_source.index("\n}", archive_span_body)
global_span = """
    static_cast<void>(hour);
    const auto& archived = s_completed.totals;
    return hydronic_evidence_before(
        archived.last_evidence_unix_us, archived.last_accepted_unix_us, archived.duration_edges,
        payload.first_unix_us, payload.first_accepted_unix_us, payload.duration_edges) ||
        hydronic_evidence_before(
            payload.last_unix_us, payload.last_accepted_unix_us, payload.duration_edges,
            archived.first_evidence_unix_us, archived.first_accepted_unix_us, archived.duration_edges);
"""
name = "global_archive_span"
compiled_control = compile_control(
    name, store_source[:archive_span_body] + global_span.rstrip() + store_source[archive_span_end:])
for case, oracle in [
    ("sample_only_newer_archive_edge", "sample-only point at newer archived hour edge remains visible"),
    ("between_archived_hours", "queued sample in empty hour between archives remains visible"),
]:
    check_control(name, case, oracle, compiled_control)

for name, needle, replacement, oracles in [
    ("omit_archive_rollback", " ||\n        (now_wall >= 0 && s_completed.totals.last_evidence_unix_us > now_wall)", "",
     [("archive_clock_rollback", "tolerated rollback withdraws the future archive without reads or a fence")]),
    ("retain_rolled_back_edges", "s_completed_expiry = s_archive_first_bucket = INT64_MIN;\n        s_restore_pending",
     "s_completed_expiry = INT64_MIN;\n        s_restore_pending",
     [("archive_clock_rollback_live", "unpublished archive edges no longer suppress the admitted live point")]),
    ("ignore_archive_wake", " &&\n            (!s_archive_wake_us || wall < s_archive_wake_us)", "",
     [("future_archive_due", "quiet service restores future record at its admitted endpoint"),
      ("future_bucket_due", "bucket opening schedules its later endpoint without early admission")]),
    ("omit_future_bucket_wake", "            defer_until(bucket * OBSERVATION_HOUR_US);", "",
     [("future_bucket_due", "bucket opening schedules its later endpoint without early admission")]),
    ("publish_across_archive_wake", " || (wake && publish_wall >= wake)", "",
     [("future_boundary_during_rebuild",
       "publication cannot close a rebuild that crossed its future admission boundary")]),
]:
    if store_source.count(needle) != 1:
        raise SystemExit(f"Negative control {name}: production mutation point changed")
    compiled_control = compile_control(name, store_source.replace(needle, replacement, 1))
    for case, oracle in oracles:
        check_control(name, case, oracle, compiled_control)

codec = codec_source.read_text()
edge_helper = codec.index("inline bool hydronic_evidence_before(")
edge_return = codec.index("    return last < first ||", edge_helper)
edge_end = codec.index("\n}", edge_return)
ignore_duration = (
    "    static_cast<void>(last_edges);\n    static_cast<void>(first_edges);\n"
    "    return last < first || (last == first && (last_sample != last || first_sample != first));"
)
strict_disjoint = (
    "    static_cast<void>(last_edges);\n    static_cast<void>(first_edges);\n"
    "    static_cast<void>(last_sample);\n    static_cast<void>(first_sample);\n"
    "    return last < first;"
)
for name, body, oracles in [
    ("ignore_shared_duration_tick", ignore_duration,
     [("shared_duration_archive_report", "shared timed tick withheld from live archive report"),
      ("shared_duration_archive_append", "shared timed tick rejected before append despite space in span")]),
    ("reject_sample_only_contact", strict_disjoint,
     [("seam_and_revisions", "seam preserves sample populations and exact admitted interval"),
      ("sample_only_archive_edge", "sample-only point at first archived duration tick remains visible")]),
]:
    compiled_control = compile_control(name, store_source, codec[:edge_return] + body + codec[edge_end:])
    for case, oracle in oracles:
        check_control(name, case, oracle, compiled_control)
(out / "negative-controls.json").write_text(json.dumps(negative_results, indent=2) + "\n")
if any(hashlib.sha256((ROOT / name).read_bytes()).hexdigest() != digest
       for name, digest in hashes.items()):
    raise SystemExit("Source changed while the runtime fixture was running")
if hashlib.sha256(production_source.read_bytes()).hexdigest() != source_sha_before:
    raise SystemExit("Production changed during compilation or execution")
if hashlib.sha256(codec_source.read_bytes()).hexdigest() != codec_sha_before:
    raise SystemExit("Codec changed during compilation or execution")
passed = not any(result["returncode"] for result in results) and all(
    result["semantic_failure_observed"] for result in negative_results)
receipt = {"outcome": "passed" if passed else "failed", "standard": "c++17",
           "sanitizer": args.sanitizer, "source_sha256": source_sha_before,
           "inputs_unchanged": True, "input_sha256": hashes, "cases": results,
           "negative_controls": negative_results,
           "limits": ["Actual store and codec execute with deterministic SDK/flash adapters.",
                      "No target image/stack/RAM, kernel concurrency or hardware proof.",
                      "The fixture alone models new-process static initialization."]}
(out / "receipt.json").write_text(json.dumps(receipt, indent=2) + "\n")
print("Evidence:", out)
raise SystemExit(not passed)
