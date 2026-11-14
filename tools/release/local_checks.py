#!/usr/bin/env python3
"""Run the official OTA host checks before merge and retain same-user local evidence."""

from contextlib import contextmanager
import hashlib
import json
import os
from pathlib import Path
import platform
import pwd
import re
import selectors
import signal
import stat
import subprocess
import sys
import tempfile
import time
from uuid import uuid4


ROOT = Path(__file__).resolve().parents[2]
COMMANDS = (
    ("scripts/run-mock-tests.sh", "--coverage"),
    ("scripts/run-contract-tests.sh",),
)
MAX_AGE_S = 24 * 60 * 60
MAX_RECEIPT_BYTES = 4 * 1024 * 1024
SHA = re.compile(r"[0-9a-f]{40}")


class CheckError(ValueError):
    """Local verification could not establish the tested source or pass the checks."""


def check_environment():
    # Do not borrow a caller-supplied Git worktree/index or CI coverage runner identity.
    ignored = {"BASH_ENV", "ENV", "NODE_OPTIONS", "GITHUB_ACTIONS", "RUNNER_OS", "ImageOS",
               "GH_TOKEN", "GITHUB_TOKEN", "OTA_SIGNING_KEY_FILE"}
    env = {key: value for key, value in os.environ.items()
           if not key.startswith("GIT_") and key not in ignored}
    env["GIT_NO_REPLACE_OBJECTS"] = "1"
    env["GIT_OPTIONAL_LOCKS"] = "0"
    env["GIT_CONFIG_COUNT"] = "2"
    env["GIT_CONFIG_KEY_0"] = "core.fsmonitor"
    env["GIT_CONFIG_VALUE_0"] = "false"
    env["GIT_CONFIG_KEY_1"] = "core.fileMode"
    env["GIT_CONFIG_VALUE_1"] = "true"
    return env


def git(root, env, *args):
    try:
        result = subprocess.run(["git", *args], cwd=root, env=env, stdout=subprocess.PIPE,
                                stderr=subprocess.DEVNULL, check=False, timeout=30)
    except subprocess.TimeoutExpired as error:
        raise CheckError("Git did not return the local source identity") from error
    if result.returncode:
        raise CheckError("Git could not establish the local source identity")
    return result.stdout.decode("utf-8", errors="surrogateescape")


def source(root, env):
    if git(root, env, "status", "--porcelain=v1", "--untracked-files=all"):
        raise CheckError("local release checks need a clean checkout")
    if any(not entry.startswith("H ") for entry in git(root, env, "ls-files", "-v", "-z").split("\0") if entry):
        raise CheckError("local release checks need an ordinary index without hidden or sparse paths")
    head = git(root, env, "rev-parse", "--verify", "HEAD").strip()
    tree = git(root, env, "rev-parse", "--verify", "HEAD^{tree}").strip()
    base = git(root, env, "rev-parse", "--verify", "HEAD^1^{commit}").strip()
    if not all(SHA.fullmatch(value) for value in (head, tree, base)):
        raise CheckError("local release checks require the full HEAD, tree and first-parent SHAs")
    # Coverage reads the baseline from HEAD and HEAD^1. A changed squash parent retires the proof.
    return head, tree, base


def hydrate_parent_coverage(root, env, base):
    # A filtered clone may still need this parent blob once before going offline.
    coverage_file = "tools/coverage/branch_baseline.json"
    if git(root, env, "ls-tree", base, "--", coverage_file):
        git(root, env, "cat-file", "-e", f"{base}:{coverage_file}")


@contextmanager
def frozen_checkout(root, env, identity, *, scratch_parent=None, container_visible=False):
    # The index, metadata and working files are private, and ignored caller files are excluded.
    # The container path copies its objects and never relies on a host-only alternate.
    with tempfile.TemporaryDirectory(prefix="daikin-release-source-", dir=scratch_parent) as scratch:
        checkout = Path(scratch) / "source"
        offline = {**env, "GIT_NO_LAZY_FETCH": "1", "GIT_CONFIG_GLOBAL": os.devnull, "GIT_CONFIG_NOSYSTEM": "1"}
        clone_options = ("--local", "--no-hardlinks") if container_visible else ("--shared",)
        git(root, offline, "clone", "--quiet", *clone_options, "--no-checkout", "--no-tags",
            "--template=", str(root), str(checkout))
        if container_visible and (checkout / ".git/objects/info/alternates").exists():
            raise CheckError("container build requires an isolated Git object directory")
        git(checkout, offline, "-c", "core.hooksPath=/dev/null",
            "checkout", "--detach", "--quiet", identity[0])
        if source(checkout, offline) != identity:
            raise CheckError("isolated local checkout does not match the verified Git source")
        # Do not let a partial clone silently drop the inherited coverage floor if its blob is
        # missing. A parent with no baseline is valid, but an unreadable one is not.
        hydrate_parent_coverage(checkout, offline, "HEAD^1")
        yield checkout, offline
        if source(checkout, offline) != identity:
            raise CheckError("isolated Git source changed during local release checks")


def account_home():
    return Path(pwd.getpwuid(os.getuid()).pw_dir).resolve()


def cache_path():
    return account_home() / ".cache" / "daikin-altherma-esp32" / "release-checks"


@contextmanager
def open_cache(path, *, create=False):
    """Use an owned cache without following any symlink along the path below the home directory."""
    home = account_home()
    parts = path.relative_to(home).parts
    if not parts or ".." in parts:
        raise CheckError("invalid local release cache path")
    flags = os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW
    descriptor = os.open(home, flags)
    try:
        info = os.fstat(descriptor)
        if info.st_uid != os.getuid() or info.st_mode & 0o022:
            raise CheckError("home directory must be owned and protected from writes")
        for part in parts:
            if create:
                try:
                    os.mkdir(part, 0o700, dir_fd=descriptor)
                except FileExistsError:
                    pass
            next_directory = os.open(part, flags, dir_fd=descriptor)
            os.close(descriptor)
            descriptor = next_directory
            info = os.fstat(descriptor)
            if info.st_uid != os.getuid() or info.st_mode & 0o022:
                raise CheckError("local release cache ancestors must be owned and protected from writes")
        if info.st_mode & 0o077:
            raise CheckError("local release cache must be private to the current user")
        yield descriptor
    finally:
        os.close(descriptor)


def machine_id():
    identity = [platform.system(), platform.machine(), platform.node(), os.getuid()]
    return hashlib.sha256(json.dumps(identity).encode()).hexdigest()


def receipt_name(identity):
    _, tree, base = identity
    return f"{tree}-{base}.json"


def sha256(data):
    return hashlib.sha256(data).hexdigest()


def unique_fields(pairs):
    fields = dict(pairs)
    if len(fields) != len(pairs):
        raise CheckError("duplicate local release receipt field")
    return fields


def load_receipt(directory, identity):
    try:
        fd = os.open(receipt_name(identity), os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK,
                     dir_fd=directory)
        with os.fdopen(fd, "rb") as stream:
            info = os.fstat(stream.fileno())
            if (not stat.S_ISREG(info.st_mode) or info.st_nlink != 1 or info.st_uid != os.getuid()
                    or info.st_mode & 0o077 or not 0 < info.st_size <= MAX_RECEIPT_BYTES):
                return None
            data = stream.read(MAX_RECEIPT_BYTES + 1)
        if len(data) != info.st_size:
            return None
        doc = json.loads(data, object_pairs_hook=unique_fields)
        _, tree, base = identity
        if (type(doc["schema_version"]) is not int or doc["schema_version"] != 1
                or doc["machine"] != machine_id() or doc["tree"] != tree or doc["base"] != base
                or not SHA.fullmatch(doc["head"]) or type(doc["finished_at"]) is not int
                or not 0 <= time.time() - doc["finished_at"] <= MAX_AGE_S):
            return None
        if not isinstance(doc["checks"], list) or len(doc["checks"]) != len(COMMANDS):
            return None
        for record, command in zip(doc["checks"], COMMANDS):
            if (record["command"] != list(command) or type(record["exit_code"]) is not int
                    or record["exit_code"] != 0 or not record["log"]
                    or sha256(record["log"].encode()) != record["log_sha256"]):
                return None
        return doc
    except (AttributeError, KeyError, TypeError, ValueError, OSError, RecursionError):
        return None


def save_receipt(directory, identity, records):
    head, tree, base = identity
    doc = {"schema_version": 1, "machine": machine_id(), "tree": tree, "base": base, "head": head,
           "finished_at": int(time.time()), "checks": records}
    payload = (json.dumps(doc, ensure_ascii=False) + "\n").encode()
    if len(payload) > MAX_RECEIPT_BYTES:
        raise CheckError("local release check logs exceed the receipt size limit")
    tmp = f".release-checks-{uuid4().hex}"
    fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600, dir_fd=directory)
    try:
        with os.fdopen(fd, "wb") as stream:
            stream.write(payload)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(tmp, receipt_name(identity), src_dir_fd=directory, dst_dir_fd=directory)
        os.fsync(directory)
    finally:
        try:
            os.unlink(tmp, dir_fd=directory)
        except FileNotFoundError:
            pass


def run_checks(root, env):
    records = []
    for command in COMMANDS:
        print(f"Local release check: {' '.join(command)}", flush=True)
        captured = bytearray()
        timeout = 1800
        deadline = time.monotonic() + timeout
        with subprocess.Popen([str(root / command[0]), *command[1:]], cwd=root, env=env,
                              stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                              start_new_session=True) as process, selectors.DefaultSelector() as stream:
            stream.register(process.stdout, selectors.EVENT_READ)
            try:
                while True:
                    remaining = deadline - time.monotonic()
                    if remaining <= 0 or not stream.select(remaining):
                        raise subprocess.TimeoutExpired(command, timeout)
                    chunk = os.read(process.stdout.fileno(), 65536)
                    if not chunk:
                        break
                    captured.extend(chunk)
                    if len(captured) > MAX_RECEIPT_BYTES:
                        raise CheckError(f"{command[0]} exceeded the check log limit")
                result = process.wait(timeout=max(0, deadline - time.monotonic()))
            except BaseException as error:
                try:
                    os.killpg(process.pid, signal.SIGKILL)
                except ProcessLookupError:
                    pass
                if isinstance(error, subprocess.TimeoutExpired):
                    raise CheckError("local release check exceeded its deadline") from error
                raise
        log = captured.decode("utf-8", errors="replace")
        if result:
            print(log, end="", file=sys.stderr)
            raise CheckError(f"{command[0]} failed with exit code {result}")
        if not log:
            raise CheckError(f"{command[0]} did not produce a check log")
        print(log, end="", flush=True)
        records.append({"command": list(command), "exit_code": 0,
                        "log": log, "log_sha256": sha256(log.encode())})
    return records


def verify(root, *, premerge=False, expected_head=None, require_receipt=False, fresh=False):
    env = check_environment()
    identity = source(root, env)
    if expected_head is not None and identity[0] != expected_head:
        raise CheckError("local release check HEAD differs from the expected source")
    if premerge and identity[2] != git(root, env, "rev-parse", "--verify", "origin/main^{commit}").strip():
        raise CheckError("first parent must match refreshed origin/main; use the exact PR merge tree")

    path = cache_path()
    cached = None
    if not fresh:
        try:
            with open_cache(path) as directory:
                cached = load_receipt(directory, identity)
        except (OSError, ValueError):
            pass
    if cached:
        if source(root, env) != identity:
            raise CheckError("source changed while checking local release evidence")
        print(f"Local release checks reused for exact tree {identity[1]} and base {identity[2]}", flush=True)
        return True

    hydrate_parent_coverage(root, env, identity[2])
    with frozen_checkout(root, env, identity) as (checkout, offline):
        records = run_checks(checkout, offline)
    if source(root, env) != identity:
        raise CheckError("source changed during local release checks")
    try:
        with open_cache(path, create=True) as directory:
            save_receipt(directory, identity, records)
    except (OSError, ValueError) as error:
        if premerge or require_receipt:
            raise CheckError("local checks passed but the private receipt could not be saved") from error
        print("Local checks passed without a reusable receipt", file=sys.stderr)
    return False


if __name__ == "__main__":
    if len(sys.argv) != 1:
        sys.exit("Usage: python3 tools/release/local_checks.py")
    try:
        verify(ROOT, premerge=True)
    except (CheckError, OSError) as error:
        sys.exit(f"Local release checks: {error}")
