#!/usr/bin/env python3
"""Execute complete production History and both stores with a synthetic NOR-flash port."""
import argparse
import datetime
import hashlib
import json
import os
from pathlib import Path
import shlex
import subprocess
import tempfile

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
SOURCE = ROOT / "main/history.cpp"
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--out", type=Path)
parser.add_argument("--sanitizer", choices=["none", "undefined"], default="none")
args = parser.parse_args()
OUT = args.out.resolve() if args.out else Path(tempfile.mkdtemp(prefix="daikin-history-journal-"))
if args.out:
    OUT.mkdir(parents=True, mode=0o700, exist_ok=False)
OUT.chmod(0o700)
compiler = shlex.split(os.environ.get("CXX", "c++"))
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
inputs = {Path(__file__).resolve(), HERE / "fixture.cpp", HERE / "README.md", SOURCE}
sources = [HERE / "fixture.cpp", ROOT / "main/stop_observation_store.cpp",
           ROOT / "main/hydronic_observation_store.cpp"]
for index, source in enumerate(sources):
    dependency = OUT / f"preflight-{index}.d"
    checked([*compiler, *flags, "-MM", "-MF", str(dependency),
             "-DHISTORY_PRODUCTION_SOURCE=" + json.dumps(str(SOURCE)), str(source)])
    words = shlex.split(dependency.read_text().replace("\\\n", " ").partition(":")[2])
    inputs.update((Path(value) if Path(value).is_absolute() else ROOT / value).resolve()
                  for value in words)
hashes = {str(path.relative_to(ROOT)): digest(path) for path in sorted(inputs)}
(OUT / "inputs.json").write_text(json.dumps(hashes, indent=2) + "\n")
(OUT / "preflight.json").write_text(json.dumps({
    "git_not_read": True, "compiler": version,
    "sanitizer": args.sanitizer, "source_sha256": digest(SOURCE),
    "whole_translation_unit": True, "production_body_rewrite": False,
}, indent=2) + "\n")
(OUT / "history-production-baseline.cpp").write_bytes(SOURCE.read_bytes())
for name in ["stop_observation_store.cpp", "hydronic_observation_store.cpp",
             "logic/history_persist.hpp", "logic/hydronic_hourly.hpp"]:
    (OUT / (Path(name).name + ".baseline")).write_bytes((ROOT / "main" / name).read_bytes())


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


baseline = build(SOURCE, "baseline")
cases = ["empty_boot", "mixed_scan", "retry_indexed_read", "corrupt_crc", "corrupt_source", "corrupt_version",
         "corrupt_width", "corrupt_payload", "torn_commit", "append_commit", "commit_rejected",
         "commit_error_after_accept", "readback_failure", "shutdown_drain", "wrap_slot",
         "scan_read_failure", "early_forget", "stop_commit_rejected", "stop_fence_commit_rejected",
         "core_ahead_independence", "request_rejections"]
results = []


def positive(case, extra=()):
    result = run([str(baseline), case, *(str(value) for value in extra)])
    (OUT / (case + ".txt")).write_text(result.stdout + result.stderr)
    if result.returncode or "PASS case=" + case + " " not in result.stdout or result.stderr:
        (OUT / "failure.json").write_text(json.dumps({
            "case": case, "exit_code": result.returncode, "stdout": result.stdout,
            "stderr": result.stderr,
            "inputs_unchanged": all(digest(ROOT / name) == value for name, value in hashes.items()),
        }, indent=2) + "\n")
        raise RuntimeError("Failed runtime case: " + case + "\n" + result.stdout + result.stderr)
    results.append({"case": case, "exit_code": result.returncode, "output": result.stdout.strip()})
    print(result.stdout.strip(), flush=True)


for case in cases:
    positive(case)
transports = []
for suffix in ["data", "reset", "uncommitted_reset", "late_delta"]:
    transport = OUT / (suffix + ".synthetic-flash.bin")
    positive("seed_" + suffix, [transport])
    # A new executable process gets the physical transport bytes, never Store globals.
    positive("restore_" + suffix, [transport])
    transports.append({"path": str(transport), "sha256": digest(transport),
                       "bytes": transport.stat().st_size})
unknown = run([str(baseline), "unknown_case"])
if unknown.returncode != 1 or "FAIL oracle=unknown_case case=unknown_case" not in unknown.stdout:
    raise RuntimeError("Unknown-case guard failed")

text = SOURCE.read_text()
mutations = []


def mutation(name, before, after, case, oracle):
    if text.count(before) != 1:
        raise RuntimeError("Expected one mutation anchor: " + name)
    mutations.append((name, text.replace(before, after, 1), case, oracle))


mutation("omit_hydronic_scan_dispatch",
         "            flash_index_hydronic_observation_record(r, static_cast<uint16_t>(slot));\n",
         "", "mixed_scan", "hydronic_restore_uses_latest_revision_once")
mutation("publish_partial_archive_on_read_error",
         "    if (flash_read_record(slot, record) != ESP_OK) return HydronicReadResult::Retry;",
         "    if (flash_read_record(slot, record) != ESP_OK) return HydronicReadResult::Invalid;",
         "retry_indexed_read", "transient_indexed_read_withholds_entire_staged_replay")
core_start = text.index("bool flash_record_valid(const FlashJournalRecord& r) {")
core_end = text.index("\nint flash_record_stored_index(", core_start)
mutation("treat_physical_checkup_envelope_as_core", text[core_start:core_end],
         "bool flash_record_valid(const FlashJournalRecord& r) {\n"
         "    return flash_record_physically_valid(r) &&\n"
         "        r.header.source == static_cast<uint8_t>(logic::HistoryJournalSource::Checkup);\n"
         "}\n",
         "mixed_scan", "core adapter received another logical source")
mutation("skip_damaged_recognizable_hydronic",
         "    if (!logic::hydronic_header_recognizable(h)) return;",
         "    if (!logic::hydronic_header_matches(h)) return;",
         "corrupt_source", "recognizable_damaged_envelope_withholds_restored_population")
mutation("trust_write_error_instead_of_readback",
         "    const bool committed = read_e == ESP_OK && flash_record_physically_valid(verify) &&\n"
         "                           verify.header.sequence == r.header.sequence &&\n"
         "                           verify.header.bucket == r.header.bucket;",
         "    const bool committed = e == ESP_OK;",
         "commit_error_after_accept", "readback_decides_commit_success")
mutation("skip_hydronic_round_robin_source",
         "if (src_i == kHydronicObservationSource) return flash_build_next_hydronic_observation(r);",
         "if (src_i == kHydronicObservationSource) return false;",
         "shutdown_drain", "shutdown_round_robin_drains_both_independent_sources")
mutation("omit_hydronic_history_forget",
         "    hydronic_observation_forget();\n", "",
         "early_forget", "early_history_forget_suppresses_hydronic_start_and_report")
mutation("omit_hydronic_failure_release",
         "        if (hydronic_owned) hydronic_observation_flash_failed();\n",
         "", "commit_rejected", "failed_append_releases_claim_for_real_service_retry")
mutation("erase_wrong_sector_at_wrap",
         "            return esp_partition_erase_range(s_flash_part, sector_offset,\n"
         "                                             logic::HISTORY_FLASH_ERASE_BYTES);",
         "            return esp_partition_erase_range(s_flash_part,\n"
         "                logic::HISTORY_FLASH_PARTITION_BYTES - logic::HISTORY_FLASH_ERASE_BYTES,\n"
         "                logic::HISTORY_FLASH_ERASE_BYTES);",
         "wrap_slot", "wrap_erases_exact_landing_sector_range")
mutation("omit_stop_failure_release",
         "        if (stop_owned) stop_observation_flash_failed();\n", "",
         "stop_commit_rejected", "stop_failed_append_releases_for_shared_retry")
mutation("classify_stop_request_with_committed_reader",
         "logic::observation_append_owned(r.header)", "logic::observation_header_matches(r.header)",
         "stop_fence_commit_rejected", "stop_failed_append_releases_for_shared_retry")
mutation("hydronic_success_clears_core_ahead",
         "if (!flash_is_manifest(r.header) && !stop_owned && !hydronic_owned &&\n"
         "            !flash_cycling_owned(r.header))",
         "if (!flash_is_manifest(r.header) && !stop_owned &&\n"
         "            !flash_cycling_owned(r.header))",
         "core_ahead_independence", "hydronic_success_preserves_core_ahead_episode")
controls = []
for name, body, case, oracle in mutations:
    source = OUT / (name + ".cpp")
    source.write_text(body)
    binary = build(source, name)
    result = run([str(binary), case])
    (OUT / (name + ".txt")).write_text(result.stdout + result.stderr)
    if result.returncode != 1 or "FAIL oracle=" + oracle + " case=" + case not in result.stdout:
        raise RuntimeError("Mutation failed outside required oracle: " + name + "\n" +
                           result.stdout + result.stderr)
    controls.append({"name": name, "case": case, "expected_oracle": oracle,
                     "exit_code": result.returncode, "output": result.stdout.strip(),
                     "mutant_sha256": digest(source)})
    print("DETECTED " + name + " " + result.stdout.strip(), flush=True)

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
transport = OUT / (name + ".synthetic-flash.bin")
seed = run([str(binary), "seed_late_delta", str(transport)])
(OUT / (name + "-seed.txt")).write_text(seed.stdout + seed.stderr)
if seed.returncode or "PASS case=seed_late_delta " not in seed.stdout or seed.stderr:
    raise RuntimeError("Sequence reuse mutation seed failed before the fresh-restore oracle")
case = "restore_late_delta"
result = run([str(binary), case, str(transport)])
(OUT / (name + "-restore.txt")).write_text(result.stdout + result.stderr)
oracle = "fresh_restore_retains_acknowledged_hydronic_late_delta"
if result.returncode != 1 or "FAIL oracle=" + oracle + " case=" + case not in result.stdout or result.stderr:
    raise RuntimeError("Sequence reuse escaped exact fresh-process hydronic population oracle")
request_probe = run([str(binary), "request_rejections"])
(OUT / (name + "-request.txt")).write_text(request_probe.stdout + request_probe.stderr)
if request_probe.returncode != 1 or (
        "FAIL oracle=zero_or_stale_request_rejected_before_transport case=request_rejections"
        not in request_probe.stdout) or request_probe.stderr:
    raise RuntimeError("Missing reservation escaped the before-transport request oracle")
controls.append({"name": name, "case": case, "expected_oracle": oracle,
                 "exit_code": result.returncode, "output": result.stdout.strip(),
                 "seed_output": seed.stdout.strip(), "mutant_sha256": digest(source),
                 "binary_sha256": digest(binary), "request_rejection_output": request_probe.stdout.strip()})
transports.append({"path": str(transport), "sha256": digest(transport),
                   "bytes": transport.stat().st_size, "mutation": name})
print("DETECTED " + name + " " + result.stdout.strip(), flush=True)
if any(digest(ROOT / name) != value for name, value in hashes.items()):
    raise RuntimeError("A production or harness input changed during execution")
receipt = {"outcome": "passed", "whole_translation_unit": True,
           "production_body_rewrite": False, "standard": "c++17", "sanitizer": args.sanitizer,
           "git_not_read": True, "compiler": version,
           "source_sha256": digest(SOURCE), "input_sha256": hashes, "inputs_unchanged": True,
           "cases": results, "negative_controls": controls, "commands": commands,
           "binary_sha256": digest(baseline), "synthetic_transports": transports,
           "unknown_case_output": unknown.stdout.strip(),
           "completed_utc": datetime.datetime.now(datetime.timezone.utc).isoformat(),
           "limits": ["NOR flash, mutexes, clocks and external services are host ports.",
                      "Fresh process restoration models boot state; no real reboot, power loss or flash driver proof.",
                      "Core Checkup callback is a format-checking adapter; its diagnosis semantics are tested separately.",
                      "Synthetic observations do not prove physical X10A or hydronic behavior."]}
(OUT / "receipt.json").write_text(json.dumps(receipt, indent=2) + "\n")
print(json.dumps({"outcome": "passed", "cases": len(results), "negative_controls": len(controls),
                  "receipt": str(OUT / "receipt.json")}), flush=True)
