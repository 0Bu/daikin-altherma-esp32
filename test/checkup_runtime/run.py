#!/usr/bin/env python3
"""Compile the complete production checkup TU, runtime cases and two consent regressions."""
from pathlib import Path
import argparse
import datetime
import hashlib
import json
import os
import platform
import shlex
import subprocess
import tempfile


HERE = Path(__file__).resolve().parent
CASES = [
    "buh_one_on_other_missing", "buh_second_on_first_missing", "buh_one_off_other_missing",
    "buh_both_off", "heaters_both_on", "legacy_text_unknown", "single_declared_buh_step",
    "independent_heaters", "fault_missing_sibling", "fault_worst_readable",
    "fault_worst_readable_reverse", "fault_warning_with_missing", "fault_both_normal",
    "source_freshness", "stale_finding", "backwards_clock", "generation_mismatch",
    "inflight_generation", "reset_read_barrier", "reset_during_lock", "consent_reset",
    "circulation_reset", "circulation_inflight", "pending_expiry", "restored_expiry",
    "consent_lock_new_generation", "consent_sampling_new_generation",
    "consent_lock_same_generation", "consent_sampling_same_generation",
    "consent_caller_new_generation", "consent_caller_same_generation",
    "stop_overlap", "stop_optional", "stop_route", "stop_idle_expiry", "stop_reset",
    "stop_consent", "stop_shutdown", "stop_tick_wait",
]

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--root", type=Path, default=HERE.parents[1])
parser.add_argument("--out", type=Path, help="New retained output directory; default is unique temp")
parser.add_argument("--sanitizer", choices=["none", "undefined"], default="none")
args = parser.parse_args()
ROOT = args.root.resolve()
SOURCE = ROOT / "main/checkup.cpp"
if not SOURCE.is_file():
    parser.error("--root must contain main/checkup.cpp")
if args.out:
    OUT = args.out.resolve()
    OUT.mkdir(parents=True, mode=0o700, exist_ok=False)
else:
    OUT = Path(tempfile.mkdtemp(prefix="daikin-checkup-runtime-"))
    OUT.chmod(0o700)

commands = []


def command(argv, timeout=60):
    commands.append(shlex.join([str(value) for value in argv]))
    return subprocess.run(argv, cwd=ROOT, capture_output=True, text=True, timeout=timeout)


def checked(argv):
    result = command(argv)
    if result.returncode:
        raise RuntimeError(shlex.join(argv) + "\n" + result.stdout + result.stderr)
    return result.stdout


def git_value(*argv):
    result = command(["git", "-c", "core.fsmonitor=false", *argv])
    return result.stdout.strip() if result.returncode == 0 else None


def sha256(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def input_label(path):
    if path.is_relative_to(ROOT):
        return str(path.relative_to(ROOT))
    if path.is_relative_to(HERE):
        return "harness/" + str(path.relative_to(HERE))
    return str(path)


compiler = shlex.split(os.environ.get("CXX", "c++"))
if not compiler:
    parser.error("CXX must name a compiler")
sanitizers = ["-fsanitize=undefined", "-fno-sanitize-recover=all"] if args.sanitizer == "undefined" else []
flags = ["-std=c++20", "-O0", "-g", "-fno-omit-frame-pointer", *sanitizers,
         "-I", str(HERE / "stubs"), "-I", str(ROOT / "main")]
compiler_version = checked([*compiler, "--version"])
head_before = git_value("rev-parse", "HEAD")
status_before = git_value("status", "--porcelain")
preflight = OUT / "preflight.d"
checked([*compiler, *flags, "-MM", "-MF", str(preflight),
         "-DCHECKUP_PRODUCTION_SOURCE=" + json.dumps(str(SOURCE)), str(HERE / "fixture.cpp")])
depwords = shlex.split(preflight.read_text().replace("\\\n", " ").partition(":")[2])
inputs = {Path(__file__).resolve(), HERE / "fixture.cpp", SOURCE}
inputs.update((Path(name) if Path(name).is_absolute() else ROOT / name).resolve() for name in depwords)
store_preflight = OUT / "store-preflight.d"
checked([*compiler, *flags, "-MM", "-MF", str(store_preflight),
         str(ROOT / "main/stop_observation_store.cpp")])
store_deps = shlex.split(store_preflight.read_text().replace("\\\n", " ").partition(":")[2])
inputs.update((Path(name) if Path(name).is_absolute() else ROOT / name).resolve() for name in store_deps)
inputs.update((HERE / "stubs").rglob("*.h"))
inputs.update((HERE / "stubs").rglob("*.hpp"))
before = {input_label(path): sha256(path) for path in sorted(inputs)}


def build(source, tag):
    binary = OUT / tag
    checked([*compiler, *flags, "-MMD", "-MF", str(OUT / (tag + ".d")),
             "-DCHECKUP_PRODUCTION_SOURCE=" + json.dumps(str(source)),
             str(HERE / "fixture.cpp"), str(ROOT / "main/stop_observation_store.cpp"), "-o", str(binary)])
    return binary


baseline = build(SOURCE, "baseline")
vacuity_controls = []
for case in ["buh_unknown_case", "fault_unknown_case", "consent_sampling_unknown_case",
             "consent_caller_unknown_case"]:
    result = command([str(baseline), case], timeout=15)
    if result.returncode != 1 or "FAIL oracle=unknown_case case=" + case not in result.stdout:
        raise RuntimeError("Unknown case was not rejected: " + case + "\n" + result.stdout + result.stderr)
    vacuity_controls.append({"case": case, "exit_code": result.returncode, "output": result.stdout.strip()})

case_results = []
for case in CASES:
    result = command([str(baseline), case], timeout=15)
    if result.returncode or not result.stdout.startswith("PASS case=" + case + " "):
        raise RuntimeError("Runtime case failed: " + case + "\n" + result.stdout + result.stderr)
    case_results.append({"case": case, "exit_code": result.returncode, "output": result.stdout.strip()})
    print(result.stdout.strip(), flush=True)

source_text = SOURCE.read_text()
entry = "    uint32_t consent_epoch, bool profile_confirmed) {\n"
guard = (
    "    if (!s_diagnostics_enabled.load(std::memory_order_acquire) ||\n"
    "        consent_epoch != s_diagnostics_epoch.load(std::memory_order_acquire))\n"
    "        return;"
)
for name, anchor in [("record entry", entry), ("commit guard", guard)]:
    if source_text.count(anchor) != 1:
        raise RuntimeError("Expected one production " + name + " anchor")
mutations = [
    ("omit_consent_epoch_guard",
     source_text.replace(guard, "    if (!s_diagnostics_enabled.load(std::memory_order_acquire)) return;"),
     "consent_lock_new_generation", "consent_epoch_discards_staged_sample"),
    ("recapture_consent_epoch_at_record_entry",
     source_text.replace(entry, entry + "    consent_epoch = checkup_consent_epoch();\n"),
     "consent_caller_same_generation", "consent_epoch_discards_already_collected_sample"),
]
expire_start = source_text.index("void checkup_stop_context_expire(int64_t) {")
expire_end = source_text.index("\nCheckupStopContextReport checkup_stop_context_report()", expire_start)
expire_body = source_text[expire_start:expire_end]
clock_line = "    const int64_t now_us = esp_timer_get_time();\n"
if expire_body.count(clock_line) != 1:
    raise RuntimeError("Expected one admitted expiry clock")
old_clock_body = expire_body.replace("expire(int64_t)", "expire(int64_t now_us)", 1).replace(clock_line, "", 1)
mutations.append(("use_stale_history_tick_clock",
                  source_text[:expire_start] + old_clock_body + source_text[expire_end:],
                  "stop_tick_wait", "stop_tick_flushes_before_journal_service"))
negative_controls = []
for name, contents, case, oracle in mutations:
    source = OUT / (name + ".cpp")
    source.write_text(contents)
    binary = build(source, name)
    result = command([str(binary), case], timeout=15)
    if result.returncode != 1 or "FAIL oracle=" + oracle + " case=" + case not in result.stdout:
        raise RuntimeError("Negative control not detected at its oracle: " + name + "\n" + result.stdout + result.stderr)
    negative_controls.append({"name": name, "case": case, "expected_oracle": oracle,
                              "exit_code": result.returncode, "output": result.stdout.strip(),
                              "mutant_sha256": sha256(source)})
    print("DETECTED " + name + " " + result.stdout.strip(), flush=True)

after = {input_label(path): sha256(path) for path in sorted(inputs)}
if before != after:
    raise RuntimeError("Production or harness inputs changed during the runtime test")
receipt = {
    "outcome": "passed", "source_file": "main/checkup.cpp", "source_sha256": sha256(SOURCE),
    "git_head_before": head_before, "git_head_after": git_value("rev-parse", "HEAD"),
    "git_status_before": status_before, "git_status_after": git_value("status", "--porcelain"),
    "whole_translation_unit": True, "production_body_rewrite": False,
    "compiler": compiler_version, "host": platform.platform(), "sanitizer": args.sanitizer,
    "cases": case_results, "negative_controls": negative_controls,
    "harness_vacuity_controls": vacuity_controls, "input_sha256": before,
    "inputs_unchanged": True, "commands": commands,
    "completed_utc": datetime.datetime.now(datetime.timezone.utc).isoformat(),
    "limits": [
        "SDK ports and external services are deterministic adapters; no kernel concurrency or physical measurements.",
        "Synthetic dated records use public restore APIs; no real flash/reboot/power-loss restoration or private state seed.",
        "Repeated persisted-generation tests establish live-epoch independence, not arbitrary durable generation-reuse safety.",
    ],
}
receipt_path = OUT / "receipt.json"
receipt_path.write_text(json.dumps(receipt, indent=2))
receipt_path.chmod(0o600)
print(json.dumps({"outcome": "passed", "cases": len(case_results),
                  "negative_controls": len(negative_controls), "receipt": str(receipt_path)}), flush=True)
