"""Source-bound local OTA evidence. Records prove binding, not the truth of a review's claims.

The coordinator must inspect the retained native reviewer transcript and actual harness permissions.
This module never imports a handwritten pass record or treats a child exit code as that inspection.
"""
from __future__ import annotations

import hashlib
import fcntl
from contextlib import contextmanager
import importlib.util
import json
import os
from pathlib import Path
import re
import shutil
import stat
import subprocess
import sys
import time
import uuid

ROOT = Path(__file__).resolve().parents[2]


def load_module(name, path):
    sys.path.insert(0, str(path.parent))
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


repro = load_module("local_ota_repro", ROOT / "scripts/check-reproducible-build.py")
hook = load_module("local_ota_hook", ROOT / "tools/agent-hooks/agent_hook.py")
flash_plan = load_module("local_ota_flash_plan", ROOT / "scripts/check-web-installer-plan.py")
CHECKS = {
    "host": ["scripts/run-mock-tests.sh", "--coverage"],
    "runtime": ["scripts/run-runtime-integration-tests.sh"],
    "contracts": ["scripts/run-contract-tests.sh"],
    "format": ["scripts/run-format-check.sh"],
    "domain": ["scripts/run-domain-audit.sh"],
    "docs": ["scripts/run-user-docs-audit.sh"],
    "doc-entities": ["scripts/run-doc-entity-audit.sh"],
    "descriptions": ["scripts/run-description-audit.sh"],
    "idf-matrix": ["scripts/run-esp-idf-matrix-audit.sh"],
    "ui": ["scripts/run-ui-use-case-tests.sh"],
    "localization": ["scripts/run-ui-localization-audit.sh"],
    "browser": ["scripts/run-browser-render-tests.sh"],
    "schematic": ["scripts/run-schematic-audit.sh"],
    "diagnostic-evidence": ["scripts/run-diagnostic-evidence-audit.sh"],
    "ui-gif": ["scripts/run-ui-gif-audit.sh"],
    "absence": ["tools/absence/selftest.sh"],
}
ROLES = {"doc_drift_checker", "heap_safety_reviewer", "x10a_decode_reviewer"}
MARKER = "LOCAL_OTA_REVIEW_JSON: "
MAX_LOG_BYTES = 16 * 1024 * 1024


class EvidenceError(ValueError):
    pass


def require(condition, message):
    if not condition:
        raise EvidenceError(message)


def strict_json(raw):
    def pairs(items):
        value = {}
        for key, item in items:
            require(key not in value, "duplicate evidence JSON field")
            value[key] = item
        return value
    return json.loads(raw, object_pairs_hook=pairs,
                      parse_constant=lambda _value: (_ for _ in ()).throw(EvidenceError("non-finite evidence JSON")))


def encoded(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=True).encode()


def sha256(data):
    return hashlib.sha256(data).hexdigest()


def git(root, *args):
    result = subprocess.run(["git", "-c", "core.fsmonitor=false", "--no-optional-locks", *args],
                            cwd=root, stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=True, timeout=20)
    return result.stdout


def source_snapshot(root=ROOT):
    root = root.resolve()
    # Resolve the comparison before opening source files. HEAD alone hides a clean local feature
    # commit, while shallow or missing remote history cannot establish its complete review scope.
    try:
        require(git(root, "rev-parse", "--is-shallow-repository").strip() == b"false",
                "complete origin/main history is required; shallow source snapshots are unsupported")
        head = git(root, "rev-parse", "--verify", "HEAD^{commit}").decode().strip()
        remote = git(root, "rev-parse", "--verify", "refs/remotes/origin/main^{commit}").decode().strip()
        bases = git(root, "merge-base", "--all", head, remote).decode().splitlines()
    except subprocess.CalledProcessError as error:
        raise EvidenceError("usable origin/main history and a comparison base are required") from error
    require(re.fullmatch(r"[0-9a-f]{40}", head) is not None and len(bases) == 1 and
            re.fullmatch(r"[0-9a-f]{40}", bases[0]) is not None,
            "one unambiguous origin/main comparison base is required")
    base = bases[0]
    paths = set()
    for args in (("ls-tree", "-rz", "--name-only", "HEAD"),
                 ("ls-tree", "-rz", "--name-only", base),
                 ("ls-files", "-z", "--cached", "--others", "--exclude-standard")):
        paths.update(raw.decode("utf-8") for raw in git(root, *args).split(b"\0") if raw)
    require(paths, "source inventory is empty")
    # Validate the complete inventory before reading any source file. Ignored private files never
    # enter it; accidentally tracked or newly exposed sensitive paths stop the snapshot unopened.
    for path in paths:
        relative = repro._safe_relative(path)
        require(not hook.is_sensitive_path(path) and
                not any(part in {".git", ".ssh", ".aws", ".gnupg"} for part in relative.parts) and
                relative.suffix.lower() not in {".bin", ".elf", ".dmp", ".dump", ".core", ".coredump"},
                "source inventory contains a private or raw-artifact path")
    entries = []
    for path in sorted(paths):
        candidate = root / path
        try:
            metadata = candidate.lstat()
        except FileNotFoundError:
            entries.append({"path": path, "kind": "deleted"})
            continue
        require(stat.S_ISREG(metadata.st_mode), "source symlinks, submodules and special files require explicit materialization")
        data, mode = repro._read_regular_at(root, repro._safe_relative(path), "local source", repro.MAX_SOURCE_FILE)
        entries.append({"path": path, "kind": "file", "mode": mode, "bytes": len(data), "sha256": sha256(data)})
    changed = set(raw.decode() for raw in git(root, "diff", "--no-ext-diff", "--no-textconv",
                                             "--name-only", "-z", base, "--").split(b"\0") if raw)
    changed.update(raw.decode() for raw in git(root, "ls-files", "--others", "--exclude-standard", "-z").split(b"\0") if raw)
    manifest = {"base": base, "head": head, "entries": entries}
    return {**manifest, "sha256": sha256(encoded(manifest)), "changed_paths": sorted(changed)}


def required_evidence(source, root=ROOT):
    """Use the existing PR gate's actual scope filters, without a second path-policy list."""
    text = (root / "tools/agent-hooks/require-pr-gates.sh").read_text()
    filters = dict(re.findall(r'check_gate "([^"]+)" "[^"]+" \\\n\s*\'([^\']+)\'', text))
    require({"heap-safety-review", "feature-docs", "ui-use-case-review", "user-docs-review",
             "absence-review", "schematic-review", "diagnostic-evidence-review", "ui-gif"} == set(filters),
            "canonical review scope filters are unavailable")
    relevant = {name for name, pattern in filters.items()
                if any(re.search(pattern, path) for path in source["changed_paths"])}
    checks = {"host", "runtime", "contracts", "format", "domain", "build"}
    reviews = {"doc_drift_checker"}  # Independent project/contract review of every local candidate.
    if "heap-safety-review" in relevant:
        reviews.add("heap_safety_reviewer")
    if "feature-docs" in relevant:
        checks.add("idf-matrix")
    if "user-docs-review" in relevant:
        checks.update({"docs", "doc-entities", "descriptions"})
    if "ui-use-case-review" in relevant:
        checks.update({"ui", "localization", "browser", "ui-gif"})
    if "absence-review" in relevant:
        checks.update({"ui", "absence"})
    for gate_name, check_name in (("schematic-review", "schematic"),
                                  ("diagnostic-evidence-review", "diagnostic-evidence"), ("ui-gif", "ui-gif")):
        if gate_name in relevant:
            checks.add(check_name)
    # The focused reviewer's maintained production-path list determines when its expertise applies.
    profile = (root / ".agents/agents/x10a-decode-reviewer.toml").read_text()
    decode_paths = set(re.findall(r"main/[A-Za-z0-9_./-]+", profile))
    require(decode_paths, "canonical decode reviewer scope is unavailable")
    if any(path == scope.rstrip(".") or (scope.endswith("/") and path.startswith(scope))
           for path in source["changed_paths"] for scope in decode_paths):
        reviews.add("x10a_decode_reviewer")
    return {"checks": sorted(checks), "reviews": sorted(reviews), "canonical_gates": sorted(relevant)}


def receipt_path(path, root=ROOT):
    require(path.is_absolute(), "evidence receipt must be absolute")
    return repro._canonical_external(path, root, "local OTA evidence")


def read_private(path, limit):
    data, mode = repro._read_regular_at(path.parent, repro._safe_relative(path.name), "private evidence", limit, nonempty=True)
    require(mode & 0o077 == 0, "evidence/log permissions must be private")
    return data


def save_receipt(path, document):
    require(path.parent.stat().st_mode & 0o077 == 0, "evidence directory must be private")
    temporary = path.parent / ("receipt-" + uuid.uuid4().hex + ".next")
    descriptor = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    with os.fdopen(descriptor, "wb") as stream:
        stream.write(encoded(document) + b"\n")
        stream.flush()
        os.fsync(stream.fileno())
    os.replace(temporary, path)
    descriptor = os.open(path.parent, repro.DIR_FLAGS)
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)


@contextmanager
def receipt_lock(path):
    descriptor = os.open(path.parent / "receipt.lock", os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW, 0o600)
    try:
        fcntl.flock(descriptor, fcntl.LOCK_EX)
        yield
    finally:
        os.close(descriptor)


def create_receipt(path, coordinator_id, root=ROOT):
    path = receipt_path(path, root)
    require(re.fullmatch(r"[0-9A-Za-z_./:-]{1,160}", coordinator_id) is not None, "actual coordinator identity is required")
    path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    with receipt_lock(path):
        require(not path.exists(), "use a new evidence receipt for each source snapshot")
        source = source_snapshot(root)
        document = {"schema_version": 1, "coordinator_id": coordinator_id, "source": source,
                    "required": required_evidence(source, root), "checks": {}, "reviews": {}}
        save_receipt(path, document)
    return document


def load_receipt(path, expected_source=None, root=ROOT):
    path = receipt_path(path, root)
    document = strict_json(read_private(path, 8 * 1024 * 1024))
    require(isinstance(document, dict) and document.get("schema_version") == 1, "unsupported local OTA evidence")
    current = source_snapshot(root)
    require(document.get("source") == current, "source changed; all local evidence must be regenerated")
    require(expected_source is None or current["sha256"] == expected_source, "requested source fingerprint does not match")
    require(document.get("required") == required_evidence(current, root), "required local evidence scope changed")
    require(isinstance(document.get("checks"), dict) and isinstance(document.get("reviews"), dict),
            "check and review records are absent")
    require(isinstance(document.get("coordinator_id"), str) and document["coordinator_id"], "coordinator identity is absent")
    return document


def begin_action(path, kind, name, root):
    with receipt_lock(path):
        document = load_receipt(path, root=root)
        require(document[kind].get(name, {}).get("status") != "running", "this evidence action is already running")
        token = uuid.uuid4().hex
        document[kind][name] = {"status": "running", "token": token}
        save_receipt(path, document)
        return document, token


def finish_action(path, kind, name, token, record, root):
    # Independent actions may run concurrently. Merge under a short lock and compare the exact
    # action token rather than replacing another action's completed records with an older copy.
    with receipt_lock(path):
        document = load_receipt(path, root=root)
        require(document[kind].get(name, {}).get("token") == token, "evidence action ownership changed")
        document[kind][name] = record
        save_receipt(path, document)
        return document


def capture(argv, log, root=ROOT, environment=None, timeout=1800):
    descriptor = os.open(log, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    started = time.time_ns()
    with os.fdopen(descriptor, "wb") as stream:
        result = subprocess.run(argv, cwd=root, env=environment, stdout=stream, stderr=subprocess.STDOUT,
                                check=False, timeout=timeout)
        stream.flush()
        os.fsync(stream.fileno())
    return {"argv": argv, "exit_code": result.returncode, "started_ns": started,
            "finished_ns": time.time_ns(), "log": log.name,
            "log_sha256": sha256(read_private(log, MAX_LOG_BYTES))}


def file_record(path):
    data, _mode = repro._read_regular_at(path.parent, repro._safe_relative(path.name), "local build artifact", repro.MAX_FLASH_INPUT, nonempty=True)
    return {"path": str(path), "bytes": len(data), "sha256": sha256(data)}


def signed_capacity(unsigned_bytes, build_source):
    """Apply the captured partition and CI budgets before any signing or review can proceed."""
    require(type(unsigned_bytes) is int and unsigned_bytes > 0, "unsigned image size is invalid")
    config, _mode = repro._read_regular_at(build_source, repro._safe_relative("sdkconfig"), "build configuration", repro.MAX_SOURCE_FILE)
    values = dict(re.findall(r"^(CONFIG_[A-Z0-9_]+)=(.*)$", config.decode(), re.MULTILINE))
    require(all(values.get(key) == value for key, value in {
        "CONFIG_IDF_TARGET": '"esp32s3"', "CONFIG_PARTITION_TABLE_CUSTOM": "y",
        "CONFIG_PARTITION_TABLE_CUSTOM_FILENAME": '"partitions.csv"',
        "CONFIG_PARTITION_TABLE_FILENAME": '"partitions.csv"',
        "CONFIG_SECURE_SIGNED_APPS_NO_SECURE_BOOT": "y", "CONFIG_SECURE_SIGNED_APPS_RSA_SCHEME": "y",
        "CONFIG_SECURE_SIGNED_ON_UPDATE_NO_SECURE_BOOT": "y",
    }.items()) and all(values.get(key, "n") == "n" for key in
                      ("CONFIG_SECURE_BOOT", "CONFIG_SECURE_BOOT_BUILD_SIGNED_BINARIES")),
            "signed-size prediction requires the pinned unsigned ESP32-S3 RSA/no-hardware-Secure-Boot configuration")
    ci, _mode = repro._read_regular_at(build_source, repro._safe_relative("scripts/ci-build-all.sh"), "CI size policy", repro.MAX_SOURCE_FILE)
    limits = re.findall(rb"^APP_SIZE_LIMIT=\$\(\((0x[0-9a-fA-F]+)\)\)\s*(?:#.*)?$", ci, re.MULTILINE)
    reserves = re.findall(rb'^\s*\[ "\$MODE" = publish \] \|\| policy_limit=\$\(\(APP_SIZE_LIMIT - (0x[0-9a-fA-F]+)\)\)\s*$',
                          ci, re.MULTILINE)
    require(len(limits) == len(reserves) == 1 and b'policy_limit="$APP_SIZE_LIMIT"' in ci and
            b'[ "$sz" -le "$policy_limit" ]' in ci, "canonical CI image-size policy is unavailable")
    limit, signature = int(limits[0], 0), int(reserves[0], 0)
    require(signature == flash_plan.FLASH_SECTOR_SIZE and limit > signature,
            "unsupported CI signature-sector reservation")
    try:
        geometry = flash_plan.partition_geometries(build_source / "partitions.csv")
    except SystemExit as error:
        raise EvidenceError("canonical OTA partition geometry is unavailable") from error
    require("ota_1" in geometry, "both OTA app slots are required")
    slot = min(geometry[name][1] for name in ("ota_0", "ota_1"))
    predicted = ((unsigned_bytes + signature - 1) // signature) * signature + signature
    require(predicted <= slot, f"predicted signed image exceeds OTA app slot: {predicted} > {slot}")
    require(unsigned_bytes <= limit - signature and predicted <= limit,
            f"predicted signed image exceeds canonical CI image-size budget: {predicted} > {limit}")
    return {"unsigned_bytes": unsigned_bytes, "predicted_signed_bytes": predicted, "slot_bytes": slot,
            "signed_ci_limit_bytes": limit, "unsigned_ci_limit_bytes": limit - signature,
            "signature_sector_bytes": signature, "sdkconfig_sha256": sha256(config)}


def check_command(name, root=ROOT):
    require(name in CHECKS, "unknown local check")
    return [str(root / CHECKS[name][0]), *CHECKS[name][1:]]


def assert_build_source(build_source, source, root=ROOT):
    """Compare the isolated inputs exactly, pruning generated output with the captured Git policy."""
    expected = {entry["path"] for entry in source["entries"] if entry["kind"] == "file"}
    actual = set()
    pending = [build_source]
    while pending:
        directory = pending.pop()
        children = list(directory.iterdir())
        if not children:
            continue
        names = [str(path.relative_to(build_source)) + ("/" if path.is_dir() else "") for path in children]
        require(all(Path(name).parts[0] != ".git" for name in names), "isolated build must not acquire Git metadata")
        result = subprocess.run(["git", "-c", "core.fsmonitor=false", "check-ignore", "--no-index", "-z", "--stdin"],
                                cwd=root, input=b"\0".join(name.encode() for name in names) + b"\0",
                                stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=False, timeout=20)
        require(result.returncode in (0, 1), "cannot apply the captured build-output ignore policy")
        ignored = {raw.decode().rstrip("/") for raw in result.stdout.split(b"\0") if raw}
        for path, name in zip(children, names):
            relative = name.rstrip("/")
            if relative in ignored and relative not in expected:
                continue
            metadata = path.lstat()
            if stat.S_ISDIR(metadata.st_mode):
                pending.append(path)
            else:
                require(stat.S_ISREG(metadata.st_mode), "isolated source acquired a link or special file")
                actual.add(relative)
    require(actual == expected, "isolated build source inventory changed")
    for entry in source["entries"]:
        if entry["kind"] != "file":
            require(not (build_source / entry["path"]).exists(), "deleted source reappeared in isolated build")
            continue
        data, mode = repro._read_regular_at(build_source, repro._safe_relative(entry["path"]), "bound build source", repro.MAX_SOURCE_FILE)
        require(sha256(data) == entry["sha256"] and mode == entry["mode"], "isolated build source changed")


def run_check(path, name, root=ROOT):
    document = load_receipt(path, root=root)
    require(name in document["required"]["checks"], "check is outside the selected canonical scope")
    document, token = begin_action(path, "checks", name, root)
    log = path.parent / (name + "-" + uuid.uuid4().hex + ".log")
    environment = dict(os.environ)
    environment.pop("DAIKIN_BROWSER_ALLOW_LOCAL_SKIP", None)
    if name == "build":
        # Keep full source copies outside the repository so nested AGENTS.md files cannot alter
        # its instruction chain. Choose an external private receipt directory shared by Docker.
        build_source = path.parent / ("build-source-" + uuid.uuid4().hex)
        build_source.mkdir(mode=0o700)
        for entry in document["source"]["entries"]:
            if entry["kind"] == "deleted":
                continue
            relative = repro._safe_relative(entry["path"])
            data, mode = repro._read_regular_at(root, relative, "captured build source", repro.MAX_SOURCE_FILE)
            require(sha256(data) == entry["sha256"] and mode == entry["mode"], "source changed during build preparation")
            repro._write_regular_at(build_source, relative, data, mode, "isolated local build source")
        assert_build_source(build_source, document["source"], root)
        argv = [str(build_source / "scripts/idf-docker.sh"), "idf.py", "-D", "IDF_TARGET=esp32s3", "build"]
    else:
        argv = check_command(name, root)
    if name == "format":
        formatter = shutil.which("clang-format-18") or environment.get("CLANG_FORMAT")
        require(formatter, "the pinned clang-format is required; the format check cannot be skipped")
        environment["CLANG_FORMAT"] = formatter
    record = capture(argv, log, root, environment)
    record["source_sha256"] = document["source"]["sha256"]
    # A failing run is retained and never converted into a pass. A later source edit invalidates it.
    if name == "format":
        record["formatter"] = environment["CLANG_FORMAT"]
    if name == "build" and record["exit_code"] == 0:
        assert_build_source(build_source, document["source"], root)
        record["build_source"] = str(build_source)
        record["unsigned_image"] = file_record(build_source / "build/daikin-altherma-esp32.bin")
        record["elf"] = file_record(build_source / "build/daikin-altherma-esp32.elf")
        try:
            record["capacity"] = signed_capacity(record["unsigned_image"]["bytes"], build_source)
        except (ValueError, OSError) as error:
            record["validation_error"] = str(error)
            finish_action(path, "checks", name, token, record, root)
            raise
        record["target"] = "esp32s3"
        stack_log = path.parent / ("stack-" + uuid.uuid4().hex + ".log")
        stack_argv = [str(build_source / "scripts/idf-docker.sh"), "python3", "scripts/check-stack-budget.py",
                      "--elf", "build/daikin-altherma-esp32.elf"]
        record["stack"] = capture(stack_argv, stack_log, root, environment)
        record["stack"]["source_sha256"] = document["source"]["sha256"]
        record["exit_code"] = record["stack"]["exit_code"]
    require(source_snapshot(root) == document["source"], "source changed during check; regenerate every evidence record")
    document = finish_action(path, "checks", name, token, record, root)
    require(record["exit_code"] == 0, "local check failed; inspect its retained log")
    return document


def profile_sha256(role, root=ROOT):
    require(role in ROLES, "unknown independent reviewer profile")
    relative = repro._safe_relative(".agents/agents/" + role.replace("_", "-") + ".toml")
    data, _mode = repro._read_regular_at(root, relative, "canonical reviewer profile", 128 * 1024, nonempty=True)
    return sha256(data)


def parse_review_report(raw, source, role, coordinator_id, scope, build_sha256, expected_profile_sha256):
    text = raw.decode("utf-8")
    messages, thread_ids = [], set()
    completed_turns = 0
    failed = False
    for line in text.splitlines():
        try:
            event = json.loads(line)
        except json.JSONDecodeError:
            continue  # CLI warnings are retained, never mistaken for native tool evidence.
        if not isinstance(event, dict):
            continue
        kind = event.get("type")
        if kind == "thread.started":
            thread = event.get("thread_id")
            require(isinstance(thread, str) and thread.strip() and len(thread) <= 160,
                    "native CLI thread identity is absent")
            thread_ids.add(thread)
        elif kind == "turn.completed":
            completed_turns += 1
        elif kind in {"turn.failed", "error"}:
            failed = True
        if kind != "item.completed":
            continue
        item = event.get("item", {})
        if item.get("type") == "agent_message" and isinstance(item.get("text"), str):
            messages.append(item["text"])
    require(len(thread_ids) == 1 and completed_turns > 0 and not failed,
            "one successful actual independent CLI session is required")
    lines = [line[len(MARKER):] for message in messages for line in message.splitlines() if line.startswith(MARKER)]
    require(lines, "one completed native reviewer record is required")
    records = [strict_json(line) for line in lines]
    require(all(isinstance(record, dict) for record in records), "native reviewer record is not an object")
    require(all(record == records[0] for record in records), "conflicting repeated native review records")
    record = records[0]  # Codex can repeat the same final answer on stderr and stdout.
    require(isinstance(scope, list) and scope and all(isinstance(path, str) and path for path in scope),
            "native review scope is absent")
    require(record.get("source_sha256") == source and record.get("build_sha256") == build_sha256 and record.get("role") == role and
            record.get("coordinator_id") == coordinator_id and record.get("scope") == scope,
            "independent review source, role, identity or scope does not match")
    reviewer = next(iter(thread_ids))
    require(reviewer != coordinator_id and record.get("reviewer_id", reviewer) == reviewer,
            "reviewer identity must be the actual distinct CLI thread")
    require(record.get("execution_kind") == "independent-profile-session" and
            record.get("profile_sha256") == expected_profile_sha256,
            "review must identify the exact independently loaded canonical profile")
    require(record.get("sandbox_mode") == "read-only" and record.get("approval_policy") == "never" and
            record.get("complete") is True and type(record.get("blocking_findings")) is int and
            record["blocking_findings"] == 0, "review is incomplete, writable, unobserved or has blockers")
    require(any(len(message.split(MARKER, 1)[0].strip()) >= 200 for message in messages if MARKER in message),
            "a substantive completed review is required, not an empty checklist")
    return {**record, "reviewer_id": reviewer}


def run_review(path, role, scope, intent, root=ROOT):
    document = load_receipt(path, root=root)
    require(role in ROLES and role in document["required"]["reviews"], "review role is outside the canonical scope")
    require(scope and all(any(item == "." or changed == item or changed.startswith(item.rstrip("/") + "/")
                             for item in scope) for changed in document["source"]["changed_paths"]),
            "review scope must include the complete changed source, including untracked files")
    source = document["source"]["sha256"]
    head = document["source"]["head"]
    identity = verify_build(document, path, root)
    build = document["checks"]["build"]
    intent += (f" Exact local build evidence: receipt {path}; build identity {identity['build_sha256']}; "
               f"unsigned app SHA-256 {identity['unsigned_image_sha256']}; ELF SHA-256 {identity['elf_sha256']}; "
               f"exact-ELF stack-check log {path.parent / build['stack']['log']}. "
               "Review the source and this resulting build together, keeping hardware claims unverified.")
    require(len(intent.encode()) <= 4096, "local review intent plus build binding exceeds the canonical bound")
    argv = [str(root / "scripts/run-codex-review.sh"), role, document["source"]["base"], head, *scope, "--intent", intent,
            "--local-ota-source-sha256", source, "--local-ota-build-sha256", identity["build_sha256"],
            "--local-ota-coordinator-id", document["coordinator_id"]]
    log = path.parent / (role + "-" + uuid.uuid4().hex + ".log")
    document, token = begin_action(path, "reviews", role, root)
    execution = capture(argv, log, root, timeout=1800)
    execution["source_sha256"] = source
    require(source_snapshot(root) == document["source"], "source changed during review; regenerate all local evidence")
    try:
        require(execution["exit_code"] == 0, "canonical native review failed; retain its transcript")
        current = load_receipt(path, root=root)
        require(verify_build(current, path, root) == identity, "build changed during review")
        record = parse_review_report(read_private(log, MAX_LOG_BYTES), source, role, document["coordinator_id"], scope,
                                     identity["build_sha256"], profile_sha256(role, root))
    except (EvidenceError, ValueError):
        finish_action(path, "reviews", role, token, {"complete": False, "execution": execution}, root)
        raise
    document = finish_action(path, "reviews", role, token, {**record, "intent": intent, "execution": execution}, root)
    return document


def validate_execution(record, path, source):
    require(isinstance(record, dict) and record.get("source_sha256") == source and
            record.get("validation_error") is None and
            type(record.get("exit_code")) is int and record["exit_code"] == 0 and type(record.get("started_ns")) is int and
            type(record.get("finished_ns")) is int and record["finished_ns"] >= record["started_ns"],
            "missing, failed or stale local execution")
    log = path.parent / repro._safe_relative(record.get("log", ""))
    require(sha256(read_private(log, MAX_LOG_BYTES)) == record.get("log_sha256"), "local evidence log changed")
    return log


def verify_build(document, path, root):
    source = document["source"]["sha256"]
    build = document["checks"].get("build")
    validate_execution(build, path, source)
    build_source = Path(build.get("build_source", ""))
    require(build_source.is_absolute() and build_source.parent == path.parent and
            build_source.name.startswith("build-source-"), "isolated build source binding is absent")
    require(build.get("argv") == [str(build_source / "scripts/idf-docker.sh"), "idf.py", "-D", "IDF_TARGET=esp32s3", "build"] and
            build.get("target") == "esp32s3", "pinned ESP32-S3 Docker build evidence is absent")
    validate_execution(build.get("stack"), path, source)
    require(build["stack"].get("argv") == [str(build_source / "scripts/idf-docker.sh"), "python3",
            "scripts/check-stack-budget.py", "--elf", "build/daikin-altherma-esp32.elf"], "exact-ELF stack check is absent")
    assert_build_source(build_source, document["source"], root)
    for field, filename in (("unsigned_image", "daikin-altherma-esp32.bin"), ("elf", "daikin-altherma-esp32.elf")):
        actual = file_record(build_source / "build" / filename)
        require(actual == build.get(field), "unsigned build image or ELF changed after verification")
    require(signed_capacity(build["unsigned_image"]["bytes"], build_source) == build.get("capacity"),
            "signed image capacity evidence is missing or changed")
    image = Path(build["unsigned_image"]["path"])
    with image.open("rb") as stream:
        descriptor = stream.read(288)
    require(len(descriptor) == 288 and descriptor[176:208].hex() == build["elf"]["sha256"], "unsigned image and ELF do not identify the same build")
    return {"build_sha256": sha256(encoded(build)), "unsigned_image_sha256": build["unsigned_image"]["sha256"],
            "elf_sha256": build["elf"]["sha256"]}


def verify_evidence(path, expected_source, signed_stream=None, root=ROOT):
    path = receipt_path(path, root)
    with receipt_lock(path):
        return _verify_evidence_locked(path, expected_source, signed_stream, root)


def _verify_evidence_locked(path, expected_source, signed_stream, root):
    document = load_receipt(path, expected_source, root)
    source = document["source"]["sha256"]
    for name in document["required"]["checks"]:
        record = document["checks"].get(name)
        validate_execution(record, path, source)
        if name != "build":
            require(record.get("argv") == check_command(name, root), "local check command is not canonical")
        if name == "format":
            require(isinstance(record.get("formatter"), str) and record["formatter"], "pinned formatter evidence is absent")
    identity = verify_build(document, path, root)
    for role in document["required"]["reviews"]:
        record = document["reviews"].get(role)
        require(isinstance(record, dict), "required independent review is absent")
        log = validate_execution(record.get("execution"), path, source)
        require(isinstance(record.get("intent"), str) and record["intent"].strip() and len(record["intent"].encode()) <= 4096,
                "independent review intent is absent")
        require(record.get("execution", {}).get("argv") == [str(root / "scripts/run-codex-review.sh"), role,
                document["source"]["base"], document["source"]["head"], *record.get("scope", []), "--intent",
                record["intent"], "--local-ota-source-sha256", source,
                "--local-ota-build-sha256", identity["build_sha256"],
                "--local-ota-coordinator-id", document["coordinator_id"]], "review did not use the canonical isolated runner")
        parsed = parse_review_report(read_private(log, MAX_LOG_BYTES), source, role,
                                     document["coordinator_id"], record.get("scope"), identity["build_sha256"], profile_sha256(role, root))
        require({key: record.get(key) for key in parsed} == parsed, "review record no longer matches actual transcript")
    build = document["checks"]["build"]
    if signed_stream is not None:
        signed_stream.seek(0)
        digest = hashlib.sha256()
        remaining = build["unsigned_image"]["bytes"]
        while remaining:
            chunk = signed_stream.read(min(65536, remaining))
            require(chunk, "signed image does not contain the verified unsigned application")
            digest.update(chunk)
            remaining -= len(chunk)
        require(digest.hexdigest() == build["unsigned_image"]["sha256"], "signed application differs from the verified local build")
        padding = (-build["unsigned_image"]["bytes"]) % 4096
        require(signed_stream.read(padding) == b"\xff" * padding and
                len(signed_stream.read(4096)) == 4096 and signed_stream.read(1) == b"",
                "signed image has unexpected alignment or signature-sector length")
        signed_stream.seek(0)
    require(source_snapshot(root) == document["source"], "source changed while verifying local evidence")
    return {"source_sha256": source, "base": document["source"]["base"], "head": document["source"]["head"],
            "receipt_sha256": sha256(read_private(path, 8 * 1024 * 1024)),
            "review_reports": {role: document["reviews"][role]["execution"]["log_sha256"]
                               for role in document["required"]["reviews"]},
            **identity}


def public_image_digest(path):
    require(path.is_absolute() and path.suffix == ".bin" and not hook.is_sensitive_path(str(path)),
            "signed firmware must be an absolute public .bin image")
    with repro._regular_fd_at(path.parent, repro._safe_relative(path.name), "signed public firmware") as (descriptor, metadata):
        require(8192 <= metadata.st_size <= 0x1F0000 and metadata.st_size % 4096 == 0,
                "signed firmware size is invalid")
        digest = hashlib.sha256()
        total = 0
        while chunk := os.read(descriptor, min(65536, metadata.st_size + 1 - total)):
            total += len(chunk)
            require(total <= metadata.st_size, "signed firmware grew during hashing")
            digest.update(chunk)
        require(total == metadata.st_size, "signed firmware changed size during hashing")
        return digest.hexdigest()


def require_upload_unused(path):
    path = receipt_path(path)
    require(not os.path.lexists(path.parent / "upload-attempt.json"),
            "this evidence receipt already owns a write attempt; do not retry")


def claim_upload_attempt(path, binding, signed_sha256):
    """Consume the one-write allowance durably before POST, including timeout/uncertain outcomes."""
    path = receipt_path(path)
    require(re.fullmatch(r"[0-9a-f]{64}", signed_sha256) is not None and
            re.fullmatch(r"[0-9a-f]{64}", binding.get("source_sha256", "")) is not None,
            "write attempt requires exact source and signed image digests")
    with receipt_lock(path):
        require(sha256(read_private(path, 8 * 1024 * 1024)) == binding.get("receipt_sha256"),
                "evidence changed after the final verification")
        marker = path.parent / "upload-attempt.json"
        try:
            descriptor = os.open(marker, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
        except FileExistsError as error:
            raise EvidenceError("this evidence receipt already owns a write attempt; do not retry") from error
        with os.fdopen(descriptor, "wb") as stream:
            stream.write(encoded({**binding, "signed_image_sha256": signed_sha256}) + b"\n")
            stream.flush()
            os.fsync(stream.fileno())
        descriptor = os.open(path.parent, repro.DIR_FLAGS)
        try:
            os.fsync(descriptor)
        finally:
            os.close(descriptor)
