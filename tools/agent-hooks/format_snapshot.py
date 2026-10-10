"""Correlate formatter work with one successful edit, without storing source contents.

An absent/ambiguous record is deliberately a no-op. The post hook only reports scoped
formatting drift; it never rewrites source, including when an editor races its checks.
"""

from __future__ import annotations

import hashlib
import fcntl
import json
import os
from pathlib import Path
import stat
import subprocess
import tempfile
import time
from typing import Any


MAX_RECORDS = 256
MAX_AGE_SECONDS = 600
MAX_TARGETS = 16
MAX_CONTENT_BYTES = 1024 * 1024


def digest(content: bytes) -> str:
    return hashlib.sha256(content).hexdigest()


def read_source(path: Path) -> bytes:
    descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    with os.fdopen(descriptor, "rb") as source:
        metadata = os.fstat(source.fileno())
        if not stat.S_ISREG(metadata.st_mode) or metadata.st_size > MAX_CONTENT_BYTES:
            raise OSError("formatter source is not a bounded regular file")
        content = source.read(MAX_CONTENT_BYTES + 1)
        if len(content) > MAX_CONTENT_BYTES:
            raise OSError("formatter source grew beyond its read budget")
        return content


def identity(payload: dict[str, Any]) -> str | None:
    fields = [payload.get(key) for key in ("session_id", "turn_id", "tool_use_id")]
    if not all(isinstance(value, str) and value for value in fields):
        return None
    return digest(json.dumps(fields, separators=(",", ":")).encode())


def input_digest(payload: dict[str, Any]) -> str:
    return digest(json.dumps(payload.get("tool_input"), sort_keys=True, separators=(",", ":")).encode())


def git(root: Path, *args: str) -> str:
    return subprocess.run(
        ["git", "-c", "core.fsmonitor=false", "-C", str(root), *args],
        check=True, capture_output=True, text=True, timeout=1,
    ).stdout.strip()


def cache_directory(root: Path) -> Path:
    directory = Path(tempfile.gettempdir()) / f"daikin-agent-format-{os.getuid()}-{digest(str(root).encode())[:16]}"
    directory.mkdir(mode=0o700, exist_ok=True)
    metadata = directory.lstat()
    if not stat.S_ISDIR(metadata.st_mode) or metadata.st_uid != os.getuid() or stat.S_IMODE(metadata.st_mode) != 0o700:
        raise OSError("formatter cache is not a private owned directory")
    return directory


def read_records(directory: Path) -> dict[Path, dict[str, Any]]:
    records: dict[Path, dict[str, Any]] = {}
    for path in directory.glob("*.json"):
        metadata = path.lstat()
        if not stat.S_ISREG(metadata.st_mode) or metadata.st_uid != os.getuid() or stat.S_IMODE(metadata.st_mode) != 0o600:
            raise OSError("unsafe formatter record")
        if time.time() - metadata.st_mtime > MAX_AGE_SECONDS:
            path.unlink()
            continue
        entry = json.loads(path.read_text())
        if not isinstance(entry, dict) or not isinstance(entry.get("paths"), dict) \
                or not isinstance(entry.get("inputs"), str) or not isinstance(entry.get("blocked"), bool) \
                or any(not isinstance(target, str) or not isinstance(evidence, dict)
                       or set(evidence) != {"expected", "head"}
                       or not all(isinstance(value, str) for value in evidence.values())
                       for target, evidence in entry["paths"].items()):
            raise ValueError("malformed formatter record")
        records[path] = entry
        if len(records) > MAX_RECORDS:
            raise OSError("formatter record budget exhausted")
    return records


def acquire_lock(directory: Path) -> int:
    # Keep one inode: unlinking a lock lets overlapping processes lock different files.
    descriptor = os.open(directory / "records.lock", os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW | os.O_NONBLOCK, 0o600)
    try:
        metadata = os.fstat(descriptor)
        if not stat.S_ISREG(metadata.st_mode) or metadata.st_uid != os.getuid() \
                or stat.S_IMODE(metadata.st_mode) != 0o600 or metadata.st_nlink != 1:
            raise OSError("unsafe formatter lock")
        # The kernel releases this non-blocking advisory lock even after process termination.
        fcntl.flock(descriptor, fcntl.LOCK_EX | fcntl.LOCK_NB)
        return descriptor
    except BaseException:
        os.close(descriptor)
        raise


def write_record(path: Path, record: dict[str, Any]) -> None:
    descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC | os.O_NOFOLLOW, 0o600)
    with os.fdopen(descriptor, "w") as output:
        json.dump(record, output, separators=(",", ":"))


def patch_result(patch: str, target: str, previous: bytes | None) -> bytes | None:
    """Accept only exact, uniquely anchored custom patch hunks; skip other forms."""
    lines = patch.splitlines()
    markers = [index for index, line in enumerate(lines)
               if line in {f"*** Add File: {target}", f"*** Update File: {target}"}]
    if len(markers) != 1:
        return None
    start = markers[0]
    end = next((index for index in range(start + 1, len(lines)) if lines[index].startswith("*** ")), len(lines))
    section = lines[start + 1:end]
    if lines[start].startswith("*** Add File:"):
        if previous is not None or not section or not all(line.startswith("+") for line in section):
            return None
        return ("\n".join(line[1:] for line in section) + "\n").encode()
    if previous is None or not previous.endswith(b"\n") or b"\r" in previous:
        return None
    source = previous.decode("utf-8").splitlines()
    hunks: list[list[str]] = []
    for line in section:
        if line.startswith("@@"):
            hunks.append([])
        elif line and line[0] in " +-":
            if not hunks:
                hunks.append([])
            hunks[-1].append(line)
        else:
            return None
    if not hunks:
        return None
    for hunk in hunks:
        before = [line[1:] for line in hunk if line[0] != "+"]
        after = [line[1:] for line in hunk if line[0] != "-"]
        if not before:
            return None
        matches = [index for index in range(len(source) - len(before) + 1)
                   if source[index:index + len(before)] == before]
        if len(matches) != 1:
            return None
        index = matches[0]
        source[index:index + len(before)] = after
    return ("\n".join(source) + "\n").encode()


def expected_content(tool: str, inputs: dict[str, Any], patch: str, target: str,
                     previous: bytes | None) -> bytes | None:
    if tool == "apply_patch":
        return patch_result(patch, target, previous)
    if tool == "write" and isinstance(inputs.get("content"), str):
        return inputs["content"].encode()
    if tool == "edit" and previous is not None:
        before, after = inputs.get("old_string"), inputs.get("new_string")
        if not isinstance(before, str) or not before or not isinstance(after, str):
            return None
        content = previous.decode("utf-8")
        if content.count(before) != 1 and inputs.get("replace_all") is not True:
            return None
        if before not in content:
            return None
        return content.replace(before, after, -1 if inputs.get("replace_all") is True else 1).encode()
    return None


def record(payload: dict[str, Any], root: Path, tool: str, inputs: dict[str, Any],
           patch: str, targets: dict[str, Path]) -> None:
    key = identity(payload)
    if key is None or not targets or len(targets) > MAX_TARGETS:
        return
    started = time.monotonic()
    lock: int | None = None
    try:
        directory = cache_directory(root)
        lock = acquire_lock(directory)
        records = read_records(directory)
        path = directory / f"{key}.json"
        touched = {str(source) for source in targets.values()}
        collision = False
        for other_path, other in records.items():
            if other_path == path or set(other.get("paths", {})) & touched:
                other["blocked"] = True
                write_record(other_path, other)
                collision = True
        if len(records) >= MAX_RECORDS and path not in records:
            return
        tracked: dict[str, dict[str, str]] = {}
        head = git(root, "rev-parse", "--verify", "HEAD")
        for target, source in targets.items():
            if time.monotonic() - started > 2 or (source.exists() and source.stat().st_size > MAX_CONTENT_BYTES):
                continue
            relative = source.relative_to(root).as_posix()
            # Untracked files already present before this tool are user work too.
            if git(root, "status", "--porcelain=v1", "--untracked-files=all", "--", relative):
                continue
            previous = read_source(source) if source.is_file() else None
            is_tracked = bool(git(root, "ls-files", "--", relative))
            if (previous is None and is_tracked) or (previous is not None and not is_tracked):
                continue
            expected = expected_content(tool, inputs, patch, target, previous)
            if expected is not None and len(expected) <= MAX_CONTENT_BYTES:
                tracked[str(source)] = {"expected": digest(expected), "head": head}
        if not tracked:
            return
        current = {"inputs": input_digest(payload), "paths": tracked, "blocked": collision}
        write_record(path, current)
    except (OSError, ValueError, UnicodeError, subprocess.SubprocessError):
        pass
    finally:
        if lock is not None:
            os.close(lock)


def consume(payload: dict[str, Any], root: Path, targets: set[str]) -> dict[str, dict[str, str]]:
    key = identity(payload)
    if key is None:
        return {}
    lock: int | None = None
    try:
        directory = cache_directory(root)
        lock = acquire_lock(directory)
        records = read_records(directory)
        path = directory / f"{key}.json"
        entry = records.get(path)
        if entry is None:
            return {}
        path.unlink()  # A post event cannot replay a previously consumed permission.
        if entry.get("blocked") or entry.get("inputs") != input_digest(payload):
            return {}
        head = git(root, "rev-parse", "--verify", "HEAD")
        return {target: evidence for target, evidence in entry.get("paths", {}).items()
                if target in targets and evidence.get("head") == head
                and digest(read_source(Path(target))) == evidence.get("expected")}
    except (OSError, ValueError, UnicodeError, subprocess.SubprocessError):
        return {}
    finally:
        if lock is not None:
            os.close(lock)
