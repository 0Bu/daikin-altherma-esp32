#!/usr/bin/env python3
"""Compile the complete production Checkup and Stop Store, runtime cases and controls."""
from pathlib import Path
import argparse
import datetime
import hashlib
import json
import os
import platform
import re
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
    "late_restore_prefix", "late_restore_clock_behind",
    "consent_lock_new_generation", "consent_sampling_new_generation",
    "consent_lock_same_generation", "consent_sampling_same_generation",
    "consent_caller_new_generation", "consent_caller_same_generation",
    "stop_overlap", "stop_optional", "stop_route", "stop_idle_expiry", "stop_reset",
    "stop_consent", "stop_shutdown", "stop_tick_wait",
    "stop_forget_pending", "stop_forget_before_start", "stop_forget_report_lock",
    "stop_forget_record_lock", "stop_forget_expiry", "stop_forget_shutdown",
    "stop_forget_during_report",
    "stop_forget_before_checkup_start", "stop_forget_report_lock_failure",
    "stop_forget_checkup_alloc_failure", "stop_unstarted_report_pending",
]

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--root", type=Path, default=HERE.parents[1])
parser.add_argument("--out", type=Path, help="New retained output directory; default is unique temp")
parser.add_argument("--sanitizer", choices=["none", "undefined"], default="none")
args = parser.parse_args()
ROOT = args.root.resolve()
SOURCE = (ROOT / "main/checkup.cpp").resolve()
STORE = (ROOT / "main/stop_observation_store.cpp").resolve()
FIXTURE = (HERE / "fixture.cpp").resolve()
if not SOURCE.is_file():
    parser.error("--root must contain main/checkup.cpp")
if args.out:
    OUT = args.out.resolve()
    OUT.mkdir(parents=True, mode=0o700, exist_ok=False)
else:
    OUT = Path(tempfile.mkdtemp(prefix="daikin-checkup-runtime-")).resolve()
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
    if path.is_relative_to(OUT):
        return "generated/" + str(path.relative_to(OUT))
    if path.is_relative_to(ROOT):
        return str(path.relative_to(ROOT))
    if path.is_relative_to(HERE):
        return "harness/" + str(path.relative_to(HERE))
    return str(path)


def dependency_paths(depfile):
    target, separator, paths = depfile.read_text().replace("\\\n", " ").strip().partition(":")
    if target != "checkup-runtime-deps" or not separator or not paths or "\n" in paths:
        raise RuntimeError("Invalid compiler dependency rule: " + str(depfile))
    words = re.findall(r"(?:\\[ \t#\\]|[^\s])+", paths)
    return {(ROOT / re.sub(r"\\([ \t#\\])", r"\1", word).replace("$$", "$")).resolve(strict=True)
            for word in words}


def check_dependencies(actual, expected, stage):
    if actual != expected:
        added = sorted(input_label(path) for path in actual - expected)
        missing = sorted(input_label(path) for path in expected - actual)
        raise RuntimeError(f"Compiler dependency mismatch for {stage}: added={added}, missing={missing}")


def check_input_hashes(expected, stage):
    for path, digest in expected.items():
        if sha256(path) != digest:
            raise RuntimeError(f"Input changed {stage}: {input_label(path)}")


compiler = shlex.split(os.environ.get("CXX", "c++"))
if not compiler:
    parser.error("CXX must name a compiler")
sanitizers = ["-fsanitize=undefined", "-fno-sanitize-recover=all"] if args.sanitizer == "undefined" else []
flags = ["-std=c++20", "-O0", "-g", "-fno-omit-frame-pointer", *sanitizers,
         "-I", str(HERE / "stubs"), "-I", str(ROOT / "main")]
compiler_version = checked([*compiler, "--version"])
head_before = git_value("rev-parse", "HEAD")
status_before = git_value("status", "--porcelain")
source_bytes = SOURCE.read_bytes()
source_digest = hashlib.sha256(source_bytes).hexdigest()


def fixture_args(source):
    return ["-DCHECKUP_PRODUCTION_SOURCE=" + json.dumps(str(source)), str(FIXTURE)]


def dependency_args(mode, depfile):
    return [mode, "-MF", str(depfile), "-MT", "checkup-runtime-deps"]


def preflight(tag, unit, required):
    depfile = OUT / (tag + "-preflight.d")
    checked([*compiler, *flags, *dependency_args("-MM", depfile), *unit])
    actual = dependency_paths(depfile)
    expected = required | {
        path for path in actual
        if path.suffix in (".h", ".hpp")
        and (path.is_relative_to(ROOT / "main") or path.is_relative_to(HERE / "stubs"))
    }
    check_dependencies(actual, expected, tag + " preflight")
    return actual


fixture_deps = preflight("fixture", fixture_args(SOURCE), {FIXTURE, SOURCE})
store_deps = preflight("store", [str(STORE)], {STORE})
inputs = fixture_deps | store_deps | {Path(__file__).resolve()}
inputs.update((HERE / "stubs").rglob("*.h"))
inputs.update((HERE / "stubs").rglob("*.hpp"))
before = {path: sha256(path) for path in sorted(inputs)}
check_input_hashes({SOURCE: source_digest}, "during preflight")
build_dependencies = {}


def build(source, digest, tag):
    # A single driver invocation with two translation units and one -MF can overwrite
    # the first dependency file. Check each object before linking or running any case.
    units = [
        ("fixture", fixture_args(source), (fixture_deps - {SOURCE}) | {source}),
        ("store", [str(STORE)], store_deps),
    ]
    expected_hashes = {path: before[path] for path in (fixture_deps | store_deps) - {SOURCE}}
    expected_hashes[source] = digest
    check_input_hashes(expected_hashes, "before " + tag)
    dependencies = {}
    objects = []
    for unit_name, unit, expected in units:
        prefix = OUT / (tag + "-" + unit_name)
        depfile = prefix.with_suffix(".d")
        obj = prefix.with_suffix(".o")
        checked([*compiler, *flags, *dependency_args("-MMD", depfile),
                 "-c", *unit, "-o", str(obj)])
        actual = dependency_paths(depfile)
        check_dependencies(actual, expected, tag + " " + unit_name)
        dependencies[unit_name] = sorted(input_label(path) for path in actual)
        objects.append(str(obj))
    binary = OUT / tag
    checked([*compiler, *flags, *objects, "-o", str(binary)])
    check_input_hashes(expected_hashes, "after " + tag)
    build_dependencies[tag] = {"checkup_source": input_label(source),
                               "checkup_source_sha256_before": digest,
                               "checkup_source_sha256_after": sha256(source),
                               **dependencies}
    return binary


baseline = build(SOURCE, source_digest, "baseline")
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

source_text = source_bytes.decode("utf-8")
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
restore_marker = "hours.hours[i].restored = true;"
if source_text.count(restore_marker) != 1:
    raise RuntimeError("Expected one restored cycling slot marker")
mutations.append(("omit_restored_cycling_slot_marker",
                  source_text.replace(restore_marker, "hours.hours[i].restored = false;"),
                  "restored_expiry", "restored_chart_keeps_its_timestamp_and_readable_time"))
tail_admission = "        if (live.count && records[i].bucket > live.newest_label) continue;\n"
if source_text.count(tail_admission) != 1:
    raise RuntimeError("Expected one saved-hour prefix admission guard")
mutations.append(("allow_saved_hour_after_live_tail", source_text.replace(tail_admission, ""),
                  "late_restore_prefix", "late_restore_admits_only_older_prefix"))
tail_clock = "reset_requested) != k)\n            return fresh_if_pending();"
if source_text.count(tail_clock) != 1:
    raise RuntimeError("Expected one live-tail clock admission guard")
mutations.append(("ignore_live_tail_clock_conflict",
                  source_text.replace(tail_clock, tail_clock.replace("return fresh_if_pending();", "continue;")),
                  "late_restore_clock_behind", "late_restore_keeps_live_when_clock_cannot_date_tail"))
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
report_start = source_text.index("CheckupStopContextReport checkup_stop_context_report() {")
report_end = source_text.index("\nvoid expire_restored_locked()", report_start)
report_body = source_text[report_start:report_end]
for name, condition, case, oracle in [
    ("omit_stop_forget_absent_mutex_default",
     "!s_mtx",
     "stop_forget_before_checkup_start", "stop_forget_no_mutex_reports_no_restore"),
    ("omit_stop_forget_failed_lock_default",
     "!lk",
     "stop_forget_report_lock_failure", "stop_forget_hides_pending_producer_state"),
]:
    default = "        r.observation.restore_pending = !stop_observation_suppressed();\n"
    guard = "    if (" + condition + ") {\n" + default + "        return r;\n    }\n"
    if report_body.count(guard) != 1:
        raise RuntimeError("Expected one Stop report unavailable return: " + name)
    changed_body = report_body.replace(guard, guard.replace(default, ""))
    mutations.append((name, source_text[:report_start] + changed_body + source_text[report_end:],
                      case, oracle))
report_guard = (
    "    if (stop_context_suppressed_locked()) {\n"
    "        r.observation.restore_pending = false;\n"
    "        return r;\n"
    "    }\n"
)
report_final_guard = (
    "    if (stop_context_suppressed_locked()) {\n"
    "        r                             = kEmptyStopReport;\n"
    "        r.observation.restore_pending = false;\n"
    "    }\n"
)
if report_body.count(report_guard) != 1 or report_body.count(report_final_guard) != 1:
    raise RuntimeError("Expected both Stop report forget guards")
mutations.append(("omit_stop_forget_report_guards",
                  source_text[:report_start] + report_body.replace(report_guard, "").replace(report_final_guard, "") +
                  source_text[report_end:],
                  "stop_forget_pending", "stop_forget_hides_pending_producer_state"))
mutations.append(("omit_stop_forget_final_report_guard",
                  source_text[:report_start] + report_body.replace(report_final_guard, "") +
                  source_text[report_end:],
                  "stop_forget_during_report", "stop_forget_hides_pending_producer_state"))
producer_guard = "!stop_context_suppressed_locked() && s_source_confirmed"
if source_text.count(producer_guard) != 1:
    raise RuntimeError("Expected one Stop producer forget guard")
mutations.append(("omit_stop_forget_producer_guard",
                  source_text.replace(producer_guard, "s_source_confirmed"),
                  "stop_forget_before_start", "stop_forget_skips_private_producer"))
expiry_guard = "    if (stop_context_suppressed_locked()) return;\n"
if expire_body.count(expiry_guard) != 1:
    raise RuntimeError("Expected one Stop expiry forget guard")
mutations.append(("omit_stop_forget_expiry_guard",
                  source_text[:expire_start] + expire_body.replace(expiry_guard, "") +
                  source_text[expire_end:],
                  "stop_forget_expiry", "stop_forget_retires_private_producer"))
negative_controls = []
mutant_hashes = {}
for name, contents, case, oracle in mutations:
    source = OUT / (name + ".cpp")
    mutant_bytes = contents.encode("utf-8")
    digest = hashlib.sha256(mutant_bytes).hexdigest()
    if digest == source_digest:
        raise RuntimeError("Negative control did not replace production bytes: " + name)
    source.write_bytes(mutant_bytes)
    mutant_hashes[source] = digest
    binary = build(source, digest, name)
    result = command([str(binary), case], timeout=15)
    if result.returncode != 1 or "FAIL oracle=" + oracle + " case=" + case not in result.stdout:
        raise RuntimeError("Negative control not detected at its oracle: " + name + "\n" + result.stdout + result.stderr)
    negative_controls.append({"name": name, "case": case, "expected_oracle": oracle,
                              "exit_code": result.returncode, "output": result.stdout.strip(),
                              "mutant_sha256": digest})
    print("DETECTED " + name + " " + result.stdout.strip(), flush=True)

check_input_hashes(before | mutant_hashes, "during runtime verification")
receipt = {
    "outcome": "passed", "source_file": "main/checkup.cpp", "source_sha256": source_digest,
    "git_head_before": head_before, "git_head_after": git_value("rev-parse", "HEAD"),
    "git_status_before": status_before, "git_status_after": git_value("status", "--porcelain"),
    "whole_translation_unit": True, "production_body_rewrite": False,
    "compiler": compiler_version, "host": platform.platform(), "sanitizer": args.sanitizer,
    "cases": case_results, "negative_controls": negative_controls,
    "harness_vacuity_controls": vacuity_controls,
    "input_sha256": {input_label(path): digest for path, digest in before.items()},
    "build_dependencies": build_dependencies,
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
