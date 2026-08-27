#!/usr/bin/env python3
"""Prove that every unsigned ESP32-S3 flash input is reproducible.

``--prepare`` freezes the exact tracked source tree before the reference build.
``--verify`` rejects worktree drift, rebuilds an immutable copy with external
build/SDKCONFIG paths and ccache disabled, compares ``flash_args`` plus every
referenced binary, and exports the exact verified bytes. ``--assert-export``
rebinds that export immediately before the one probabilistic signing step.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import shlex
import shutil
import stat
import subprocess
import sys
import tempfile
from contextlib import contextmanager
from dataclasses import dataclass
from pathlib import Path, PurePosixPath
from typing import Callable, Iterator


REPO = Path(__file__).resolve().parents[1]
MANIFEST_NAME = "tracked-source.json"
SNAPSHOT_NAME = "source"
IDENTITY_NAME = ".verified-flash-inputs.json"
APP_NAME = "daikin-altherma-esp32.bin"
MAX_SOURCE_FILE = 128 * 1024 * 1024
MAX_FLASH_INPUT = 32 * 1024 * 1024
MAX_FLASH_ARGS = 1024 * 1024
MAX_IDENTITY = 1024 * 1024
DIR_FLAGS = (
    os.O_RDONLY
    | getattr(os, "O_DIRECTORY", 0)
    | getattr(os, "O_NOFOLLOW", 0)
    | getattr(os, "O_CLOEXEC", 0)
)
FILE_FLAGS = os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0) | getattr(os, "O_CLOEXEC", 0)
SAFE_FLASH_PART = re.compile(r"^[A-Za-z0-9._-]+$")
HEX_OFFSET = re.compile(r"^0[xX][0-9a-fA-F]+$")
DECIMAL_OFFSET = re.compile(r"^[0-9]+$")
FLASH_OPTIONS = {
    "--flash-mode": re.compile(r"^(?:keep|dio|dout|qio|qout)$"),
    "--flash-freq": re.compile(r"^(?:keep|[0-9]+[kKmM])$"),
    "--flash-size": re.compile(r"^(?:keep|detect|[0-9]+(?:KB|MB))$", re.IGNORECASE),
}


class ReproducibilityError(ValueError):
    """The build cannot establish reproducibility."""


def _safe_relative(raw: bytes | str, label: str = "path") -> PurePosixPath:
    try:
        text = raw.decode("utf-8") if isinstance(raw, bytes) else raw
    except UnicodeDecodeError as exc:
        raise ReproducibilityError(f"{label} is not UTF-8") from exc
    relative = PurePosixPath(text)
    if not relative.parts or relative.is_absolute() or ".." in relative.parts:
        raise ReproducibilityError(f"unsafe {label}: {relative}")
    return relative


def _is_within(path: Path, parent: Path) -> bool:
    try:
        path.relative_to(parent)
    except ValueError:
        return False
    return True


def _canonical_external(path: Path, repo: Path, label: str) -> Path:
    raw = path if path.is_absolute() else Path.cwd() / path
    try:
        metadata = raw.lstat()
    except FileNotFoundError:
        metadata = None
    except OSError as exc:
        raise ReproducibilityError(f"cannot inspect {label}: {exc}") from exc
    if metadata is not None and stat.S_ISLNK(metadata.st_mode):
        raise ReproducibilityError(f"{label} must not be a symlink: {path}")
    resolved = raw.resolve(strict=False)
    repository = repo.resolve()
    if _is_within(resolved, repository):
        raise ReproducibilityError(f"{label} must be outside the repository: {path}")
    return resolved


def _open_directory(path: Path, label: str) -> int:
    if not path.is_absolute():
        raise ReproducibilityError(f"{label} is not absolute: {path}")
    try:
        current = os.open("/", DIR_FLAGS)
        for part in path.parts[1:]:
            next_fd = os.open(part, DIR_FLAGS, dir_fd=current)
            os.close(current)
            current = next_fd
        return current
    except OSError as exc:
        try:
            os.close(current)
        except (OSError, UnboundLocalError):
            pass
        raise ReproducibilityError(
            f"cannot bind {label} without following symlinks: {path}: {exc}"
        ) from exc


@contextmanager
def _regular_fd_at(
    root: Path,
    relative: PurePosixPath,
    label: str,
    *,
    nonempty: bool = False,
) -> Iterator[tuple[int, os.stat_result]]:
    directory_fd = _open_directory(root, f"{label} root")
    file_fd = -1
    try:
        for part in relative.parts[:-1]:
            try:
                next_fd = os.open(part, DIR_FLAGS, dir_fd=directory_fd)
            except OSError as exc:
                raise ReproducibilityError(
                    f"cannot bind directory component of {label} without following symlinks: "
                    f"{relative}: {exc}"
                ) from exc
            os.close(directory_fd)
            directory_fd = next_fd
        try:
            file_fd = os.open(relative.name, FILE_FLAGS, dir_fd=directory_fd)
            metadata = os.fstat(file_fd)
        except OSError as exc:
            raise ReproducibilityError(
                f"cannot open {label} without following symlinks: {relative}: {exc}"
            ) from exc
        if not stat.S_ISREG(metadata.st_mode):
            raise ReproducibilityError(f"{label} is not a regular file: {relative}")
        if nonempty and metadata.st_size <= 0:
            raise ReproducibilityError(f"{label} is empty: {relative}")
        yield file_fd, metadata
    finally:
        if file_fd >= 0:
            os.close(file_fd)
        os.close(directory_fd)


def _read_regular_at(
    root: Path,
    relative: PurePosixPath,
    label: str,
    limit: int,
    *,
    nonempty: bool = False,
) -> tuple[bytes, int]:
    with _regular_fd_at(root, relative, label, nonempty=nonempty) as (file_fd, metadata):
        if metadata.st_size > limit:
            raise ReproducibilityError(
                f"{label} is too large: {relative}: {metadata.st_size} > {limit}"
            )
        chunks: list[bytes] = []
        total = 0
        while True:
            block = os.read(file_fd, min(1024 * 1024, limit - total + 1))
            if not block:
                break
            chunks.append(block)
            total += len(block)
            if total > limit:
                raise ReproducibilityError(f"{label} exceeds its read limit: {relative}")
        if total != metadata.st_size:
            raise ReproducibilityError(f"{label} changed size while being read: {relative}")
        return b"".join(chunks), stat.S_IMODE(metadata.st_mode)


def _write_all(file_fd: int, data: bytes) -> None:
    view = memoryview(data)
    written = 0
    while written < len(view):
        count = os.write(file_fd, view[written:])
        if count <= 0:
            raise ReproducibilityError("short write while creating a bound file")
        written += count


def _write_regular_at(
    root: Path,
    relative: PurePosixPath,
    data: bytes,
    mode: int,
    label: str,
) -> None:
    directory_fd = _open_directory(root, f"{label} root")
    file_fd = -1
    try:
        for part in relative.parts[:-1]:
            try:
                os.mkdir(part, 0o755, dir_fd=directory_fd)
            except FileExistsError:
                pass
            except OSError as exc:
                raise ReproducibilityError(f"cannot create directory for {label}: {exc}") from exc
            try:
                next_fd = os.open(part, DIR_FLAGS, dir_fd=directory_fd)
            except OSError as exc:
                raise ReproducibilityError(
                    f"cannot bind destination directory for {label} without following symlinks: "
                    f"{relative}: {exc}"
                ) from exc
            os.close(directory_fd)
            directory_fd = next_fd
        flags = (
            os.O_WRONLY
            | os.O_CREAT
            | os.O_EXCL
            | getattr(os, "O_NOFOLLOW", 0)
            | getattr(os, "O_CLOEXEC", 0)
        )
        try:
            file_fd = os.open(relative.name, flags, mode, dir_fd=directory_fd)
            _write_all(file_fd, data)
            os.fchmod(file_fd, mode)
        except OSError as exc:
            raise ReproducibilityError(f"cannot create {label}: {relative}: {exc}") from exc
    finally:
        if file_fd >= 0:
            os.close(file_fd)
        os.close(directory_fd)


def _ensure_empty_directory(path: Path, label: str) -> None:
    parent = path.parent
    parent_fd = _open_directory(parent, f"{label} parent")
    try:
        try:
            os.mkdir(path.name, 0o700, dir_fd=parent_fd)
        except FileExistsError:
            pass
        except OSError as exc:
            raise ReproducibilityError(f"cannot create {label}: {path}: {exc}") from exc
    finally:
        os.close(parent_fd)
    directory_fd = _open_directory(path, label)
    try:
        if os.listdir(directory_fd):
            raise ReproducibilityError(f"{label} is not empty: {path}")
    finally:
        os.close(directory_fd)


def _tree_inventory(root: Path, label: str) -> tuple[set[PurePosixPath], set[PurePosixPath]]:
    files: set[PurePosixPath] = set()
    directories: set[PurePosixPath] = set()
    root_fd = _open_directory(root, label)

    def walk(directory_fd: int, prefix: PurePosixPath) -> None:
        try:
            names = sorted(os.listdir(directory_fd))
        except OSError as exc:
            raise ReproducibilityError(f"cannot enumerate {label}: {exc}") from exc
        for name in names:
            relative = prefix / name if prefix.parts else PurePosixPath(name)
            try:
                metadata = os.stat(name, dir_fd=directory_fd, follow_symlinks=False)
            except OSError as exc:
                raise ReproducibilityError(f"cannot inspect {label} entry {relative}: {exc}") from exc
            if stat.S_ISDIR(metadata.st_mode):
                directories.add(relative)
                try:
                    child_fd = os.open(name, DIR_FLAGS, dir_fd=directory_fd)
                except OSError as exc:
                    raise ReproducibilityError(
                        f"cannot bind {label} directory without following symlinks: {relative}: {exc}"
                    ) from exc
                try:
                    walk(child_fd, relative)
                finally:
                    os.close(child_fd)
            elif stat.S_ISREG(metadata.st_mode):
                files.add(relative)
            else:
                raise ReproducibilityError(
                    f"{label} contains a symlink or special file: {relative}"
                )

    try:
        walk(root_fd, PurePosixPath())
    finally:
        os.close(root_fd)
    return files, directories


def _sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def _difference_offset(left: bytes, right: bytes) -> int:
    differing = next(
        (index for index, pair in enumerate(zip(left, right)) if pair[0] != pair[1]),
        None,
    )
    return min(len(left), len(right)) if differing is None else differing


def _compare_bytes(reference: bytes, rebuilt: bytes, label: str) -> str:
    reference_hash = _sha256_bytes(reference)
    rebuilt_hash = _sha256_bytes(rebuilt)
    if reference != rebuilt:
        raise ReproducibilityError(
            f"{label} differs at byte {_difference_offset(reference, rebuilt)}: "
            f"reference {reference_hash}, rebuilt {rebuilt_hash}"
        )
    return reference_hash


Runner = Callable[[list[str], Path, dict[str, str]], None]


def run(command: list[str], cwd: Path, environment: dict[str, str]) -> None:
    try:
        result = subprocess.run(command, cwd=cwd, env=environment, check=False)
    except OSError as exc:
        raise ReproducibilityError(f"cannot execute {command[0]}: {exc}") from exc
    if result.returncode:
        raise ReproducibilityError(
            f"command failed with exit {result.returncode}: {' '.join(command)}"
        )


def tracked_paths(repo: Path) -> list[PurePosixPath]:
    try:
        result = subprocess.run(
            ["git", "-c", "core.fsmonitor=false", "ls-files", "-z"],
            cwd=repo,
            check=False,
            capture_output=True,
        )
    except OSError as exc:
        raise ReproducibilityError(f"cannot enumerate tracked source: {exc}") from exc
    if result.returncode:
        detail = result.stderr.decode("utf-8", "replace").strip()
        raise ReproducibilityError(
            f"cannot enumerate tracked source{': ' + detail if detail else ''}"
        )
    paths = [_safe_relative(raw, "tracked path") for raw in result.stdout.split(b"\0") if raw]
    if not paths:
        raise ReproducibilityError("tracked source snapshot would be empty")
    if len(paths) != len(set(paths)):
        raise ReproducibilityError("tracked source contains duplicate paths")
    return sorted(paths, key=str)


def _entry(root: Path, relative: PurePosixPath, label: str) -> dict[str, object]:
    data, mode = _read_regular_at(root, relative, label, MAX_SOURCE_FILE)
    return {
        "path": str(relative),
        "kind": "file",
        "mode": mode,
        "size": len(data),
        "sha256": _sha256_bytes(data),
    }


def source_manifest(repo: Path) -> dict[str, object]:
    entries = [_entry(repo, relative, "tracked source") for relative in tracked_paths(repo)]
    return {"schema": 1, "entries": entries}


def _validate_manifest(raw: object) -> dict[str, object]:
    if not isinstance(raw, dict) or set(raw) != {"schema", "entries"} or raw["schema"] != 1:
        raise ReproducibilityError("invalid tracked-source manifest schema")
    entries = raw["entries"]
    if not isinstance(entries, list) or not entries:
        raise ReproducibilityError("tracked-source manifest has no entries")
    previous = ""
    for entry in entries:
        if not isinstance(entry, dict) or set(entry) != {
            "path", "kind", "mode", "size", "sha256",
        }:
            raise ReproducibilityError("invalid tracked-source manifest entry")
        path = entry["path"]
        if not isinstance(path, str):
            raise ReproducibilityError("tracked-source path is not a string")
        relative = _safe_relative(path, "tracked-source path")
        if str(relative) <= previous:
            raise ReproducibilityError("tracked-source paths are not unique and sorted")
        previous = str(relative)
        if entry["kind"] != "file":
            raise ReproducibilityError(f"tracked symlinks are not permitted: {relative}")
        if not isinstance(entry["mode"], int) or not 0 <= entry["mode"] <= 0o7777:
            raise ReproducibilityError(f"invalid tracked-source mode for {relative}")
        if not isinstance(entry["size"], int) or entry["size"] < 0:
            raise ReproducibilityError(f"invalid tracked-source size for {relative}")
        digest = entry["sha256"]
        if not isinstance(digest, str) or not re.fullmatch(r"[0-9a-f]{64}", digest):
            raise ReproducibilityError(f"invalid tracked-source digest for {relative}")
    return raw


def _load_manifest(state_dir: Path) -> dict[str, object]:
    data, _ = _read_regular_at(
        state_dir,
        PurePosixPath(MANIFEST_NAME),
        "tracked-source manifest",
        MAX_IDENTITY,
        nonempty=True,
    )
    try:
        raw = json.loads(data.decode("utf-8"))
    except (UnicodeError, json.JSONDecodeError) as exc:
        raise ReproducibilityError(f"cannot parse tracked-source manifest: {exc}") from exc
    return _validate_manifest(raw)


def _expected_inventory(
    manifest: dict[str, object],
) -> tuple[set[PurePosixPath], set[PurePosixPath]]:
    files: set[PurePosixPath] = set()
    directories: set[PurePosixPath] = set()
    for entry in manifest["entries"]:  # type: ignore[index]
        relative = PurePosixPath(entry["path"])  # type: ignore[index]
        files.add(relative)
        parent = relative.parent
        while parent.parts:
            directories.add(parent)
            parent = parent.parent
    return files, directories


def _assert_tree_matches(
    root: Path,
    manifest: dict[str, object],
    label: str,
    *,
    exact: bool,
) -> None:
    if exact:
        actual_files, actual_directories = _tree_inventory(root, label)
        expected_files, expected_directories = _expected_inventory(manifest)
        extra_files = sorted(actual_files - expected_files, key=str)
        missing_files = sorted(expected_files - actual_files, key=str)
        extra_directories = sorted(actual_directories - expected_directories, key=str)
        missing_directories = sorted(expected_directories - actual_directories, key=str)
        if extra_files or missing_files or extra_directories or missing_directories:
            raise ReproducibilityError(
                f"{label} tree differs: extra files {extra_files}, missing files {missing_files}, "
                f"extra directories {extra_directories}, missing directories {missing_directories}"
            )
    for expected in manifest["entries"]:  # type: ignore[index]
        relative = PurePosixPath(expected["path"])  # type: ignore[index]
        actual = _entry(root, relative, label)
        if actual != expected:
            raise ReproducibilityError(f"{label} changed: {relative}")


def _assert_worktree_matches(repo: Path, manifest: dict[str, object], phase: str) -> None:
    expected_paths = [
        PurePosixPath(entry["path"]) for entry in manifest["entries"]  # type: ignore[index]
    ]
    if tracked_paths(repo) != expected_paths:
        raise ReproducibilityError(f"tracked path set changed {phase}")
    _assert_tree_matches(repo, manifest, f"tracked working tree {phase}", exact=False)


def _copy_manifest_source(
    source: Path,
    destination: Path,
    manifest: dict[str, object],
    label: str,
) -> None:
    _ensure_empty_directory(destination, f"{label} destination")
    for expected in manifest["entries"]:  # type: ignore[index]
        relative = PurePosixPath(expected["path"])  # type: ignore[index]
        data, mode = _read_regular_at(source, relative, label, MAX_SOURCE_FILE)
        actual = {
            "path": str(relative),
            "kind": "file",
            "mode": mode,
            "size": len(data),
            "sha256": _sha256_bytes(data),
        }
        if actual != expected:
            raise ReproducibilityError(f"{label} changed while being copied: {relative}")
        _write_regular_at(destination, relative, data, mode, f"{label} copy")
    _assert_tree_matches(destination, manifest, f"{label} copy", exact=True)


def prepare_snapshot(state_dir: Path, *, repo: Path = REPO) -> None:
    state_dir = _canonical_external(state_dir, repo, "reproducibility state")
    _ensure_empty_directory(state_dir, "reproducibility state")
    manifest = source_manifest(repo)
    snapshot = state_dir / SNAPSHOT_NAME
    _copy_manifest_source(repo.resolve(), snapshot, manifest, "tracked source")
    _assert_worktree_matches(repo.resolve(), manifest, "while snapshotting")
    payload = json.dumps(manifest, sort_keys=True, separators=(",", ":")).encode() + b"\n"
    _write_regular_at(
        state_dir,
        PurePosixPath(MANIFEST_NAME),
        payload,
        0o600,
        "tracked-source manifest",
    )


@dataclass(frozen=True)
class FlashEntry:
    offset: int
    relative: PurePosixPath


def _parse_offset(token: str) -> int | None:
    if HEX_OFFSET.fullmatch(token):
        return int(token, 16)
    if DECIMAL_OFFSET.fullmatch(token):
        return int(token, 10)
    return None


def parse_flash_args_bytes(data: bytes, label: str = "flash_args") -> list[FlashEntry]:
    try:
        text = data.decode("utf-8")
    except UnicodeDecodeError as exc:
        raise ReproducibilityError(f"{label} is not UTF-8") from exc
    entries: list[FlashEntry] = []
    offsets: set[int] = set()
    relatives: set[PurePosixPath] = set()
    options: set[str] = set()
    saw_input = False
    for line_number, line in enumerate(text.splitlines(), 1):
        if not line.strip():
            continue
        try:
            tokens = shlex.split(line, posix=True)
        except ValueError as exc:
            raise ReproducibilityError(f"invalid {label} line {line_number}: {exc}") from exc
        offset = _parse_offset(tokens[0]) if tokens else None
        if offset is not None:
            saw_input = True
            if len(tokens) != 2:
                raise ReproducibilityError(
                    f"invalid {label} input line {line_number}: expected offset and path"
                )
            if offset > 0xFFFFFFFF:
                raise ReproducibilityError(f"invalid {label} offset on line {line_number}")
            relative = _safe_relative(tokens[1], f"{label} path on line {line_number}")
            if any(not SAFE_FLASH_PART.fullmatch(part) for part in relative.parts):
                raise ReproducibilityError(
                    f"unsafe {label} path characters on line {line_number}: {relative}"
                )
            if offset in offsets or relative in relatives:
                raise ReproducibilityError(f"duplicate {label} input on line {line_number}")
            offsets.add(offset)
            relatives.add(relative)
            entries.append(FlashEntry(offset, relative))
            continue
        if tokens and tokens[0].startswith("-"):
            if saw_input:
                raise ReproducibilityError(f"{label} options follow inputs on line {line_number}")
            index = 0
            while index < len(tokens):
                option = tokens[index]
                if not option.startswith("-"):
                    raise ReproducibilityError(
                        f"unknown non-option token in {label} on line {line_number}: {option}"
                    )
                validator = FLASH_OPTIONS.get(option)
                if validator is None:
                    raise ReproducibilityError(
                        f"unknown {label} option on line {line_number}: {option}"
                    )
                if option in options:
                    raise ReproducibilityError(f"duplicate {label} option: {option}")
                if index + 1 >= len(tokens):
                    raise ReproducibilityError(f"missing value for {label} option {option}")
                value = tokens[index + 1]
                if value.startswith("-") or not validator.fullmatch(value):
                    raise ReproducibilityError(
                        f"invalid value for {label} option {option}: {value}"
                    )
                options.add(option)
                index += 2
            continue
        unknown = tokens[0] if tokens else line.strip()
        raise ReproducibilityError(
            f"unknown non-option token in {label} on line {line_number}: {unknown}"
        )
    missing_options = sorted(set(FLASH_OPTIONS) - options)
    if missing_options:
        raise ReproducibilityError(f"{label} is missing required options: {missing_options}")
    if not entries:
        raise ReproducibilityError(f"{label} contains no flash inputs")
    app_entries = [entry for entry in entries if entry.relative == PurePosixPath(APP_NAME)]
    if len(app_entries) != 1:
        raise ReproducibilityError(f"{label} must reference {APP_NAME} exactly once")
    return entries


@dataclass(frozen=True)
class FlashIdentity:
    app_sha256: str
    flash_args_sha256: str
    input_count: int


def _identity_document(
    args_hash: str,
    entries: list[tuple[FlashEntry, bytes, int, str]],
) -> dict[str, object]:
    return {
        "schema": 1,
        "flash_args_sha256": args_hash,
        "inputs": [
            {
                "offset": entry.offset,
                "path": str(entry.relative),
                "sha256": digest,
                "size": len(data),
                "mode": mode,
            }
            for entry, data, mode, digest in entries
        ],
    }


def compare_flash_inputs(
    reference_build: Path,
    rebuilt_build: Path,
    output_dir: Path,
) -> FlashIdentity:
    flash_args_rel = PurePosixPath("flash_args")
    reference_args, args_mode = _read_regular_at(
        reference_build, flash_args_rel, "reference flash_args", MAX_FLASH_ARGS, nonempty=True
    )
    rebuilt_args, rebuilt_args_mode = _read_regular_at(
        rebuilt_build, flash_args_rel, "rebuilt flash_args", MAX_FLASH_ARGS, nonempty=True
    )
    args_hash = _compare_bytes(reference_args, rebuilt_args, "flash_args")
    if args_mode != rebuilt_args_mode:
        raise ReproducibilityError("flash_args mode differs between builds")
    reference_entries = parse_flash_args_bytes(reference_args, "reference flash_args")
    rebuilt_entries = parse_flash_args_bytes(rebuilt_args, "rebuilt flash_args")
    if reference_entries != rebuilt_entries:
        raise ReproducibilityError("flash_args input plan differs after byte comparison")

    verified: list[tuple[FlashEntry, bytes, int, str]] = []
    app_hash = ""
    for entry in reference_entries:
        reference, reference_mode = _read_regular_at(
            reference_build,
            entry.relative,
            f"reference flash input {entry.relative}",
            MAX_FLASH_INPUT,
            nonempty=True,
        )
        rebuilt, rebuilt_mode = _read_regular_at(
            rebuilt_build,
            entry.relative,
            f"rebuilt flash input {entry.relative}",
            MAX_FLASH_INPUT,
            nonempty=True,
        )
        digest = _compare_bytes(reference, rebuilt, f"unsigned flash input {entry.relative}")
        if reference_mode != rebuilt_mode:
            raise ReproducibilityError(f"unsigned flash input mode differs: {entry.relative}")
        verified.append((entry, rebuilt, rebuilt_mode, digest))
        if entry.relative == PurePosixPath(APP_NAME):
            app_hash = digest
    if not app_hash:
        raise ReproducibilityError("reproduced app identity is missing")

    _ensure_empty_directory(output_dir, "verified flash-input copy")
    _write_regular_at(output_dir, flash_args_rel, rebuilt_args, rebuilt_args_mode, "flash_args copy")
    for entry, data, mode, _ in verified:
        _write_regular_at(output_dir, entry.relative, data, mode, "verified flash-input copy")
    identity = _identity_document(args_hash, verified)
    identity_bytes = json.dumps(identity, sort_keys=True, separators=(",", ":")).encode() + b"\n"
    _write_regular_at(
        output_dir,
        PurePosixPath(IDENTITY_NAME),
        identity_bytes,
        0o600,
        "flash-input identity",
    )
    rebound = assert_export_identity(output_dir)
    if rebound != FlashIdentity(app_hash, args_hash, len(verified)):
        raise ReproducibilityError("verified flash-input export identity changed while copying")
    return rebound


def _validate_identity(raw: object) -> tuple[str, list[dict[str, object]]]:
    if not isinstance(raw, dict) or set(raw) != {"schema", "flash_args_sha256", "inputs"}:
        raise ReproducibilityError("invalid flash-input identity schema")
    if raw["schema"] != 1:
        raise ReproducibilityError("unsupported flash-input identity schema")
    args_hash = raw["flash_args_sha256"]
    if not isinstance(args_hash, str) or not re.fullmatch(r"[0-9a-f]{64}", args_hash):
        raise ReproducibilityError("invalid flash_args identity")
    inputs = raw["inputs"]
    if not isinstance(inputs, list) or not inputs:
        raise ReproducibilityError("flash-input identity has no inputs")
    for item in inputs:
        if not isinstance(item, dict) or set(item) != {
            "offset", "path", "sha256", "size", "mode",
        }:
            raise ReproducibilityError("invalid flash-input identity entry")
        if not isinstance(item["offset"], int) or not 0 <= item["offset"] <= 0xFFFFFFFF:
            raise ReproducibilityError("invalid flash-input identity offset")
        _safe_relative(item["path"] if isinstance(item["path"], str) else "", "identity path")
        if not isinstance(item["sha256"], str) or not re.fullmatch(
            r"[0-9a-f]{64}", item["sha256"]
        ):
            raise ReproducibilityError("invalid flash-input identity digest")
        if not isinstance(item["size"], int) or item["size"] <= 0:
            raise ReproducibilityError("invalid flash-input identity size")
        if not isinstance(item["mode"], int) or not 0 <= item["mode"] <= 0o7777:
            raise ReproducibilityError("invalid flash-input identity mode")
    return args_hash, inputs  # type: ignore[return-value]


def assert_export_identity(output_dir: Path) -> FlashIdentity:
    identity_bytes, _ = _read_regular_at(
        output_dir,
        PurePosixPath(IDENTITY_NAME),
        "flash-input identity",
        MAX_IDENTITY,
        nonempty=True,
    )
    try:
        raw = json.loads(identity_bytes.decode("utf-8"))
    except (UnicodeError, json.JSONDecodeError) as exc:
        raise ReproducibilityError(f"cannot parse flash-input identity: {exc}") from exc
    args_hash, items = _validate_identity(raw)
    flash_args, _ = _read_regular_at(
        output_dir,
        PurePosixPath("flash_args"),
        "exported flash_args",
        MAX_FLASH_ARGS,
        nonempty=True,
    )
    if _sha256_bytes(flash_args) != args_hash:
        raise ReproducibilityError("exported flash_args no longer matches its verified identity")
    parsed = parse_flash_args_bytes(flash_args, "exported flash_args")
    expected_entries = [
        FlashEntry(item["offset"], _safe_relative(item["path"], "identity path"))
        for item in items
    ]
    if parsed != expected_entries:
        raise ReproducibilityError("exported flash_args no longer matches its input identity")

    app_hash = ""
    expected_files = {PurePosixPath("flash_args"), PurePosixPath(IDENTITY_NAME)}
    expected_directories: set[PurePosixPath] = set()
    for item, entry in zip(items, expected_entries):
        data, mode = _read_regular_at(
            output_dir,
            entry.relative,
            f"exported flash input {entry.relative}",
            MAX_FLASH_INPUT,
            nonempty=True,
        )
        if (
            len(data) != item["size"]
            or mode != item["mode"]
            or _sha256_bytes(data) != item["sha256"]
        ):
            raise ReproducibilityError(
                f"exported flash input no longer matches verified identity: {entry.relative}"
            )
        expected_files.add(entry.relative)
        parent = entry.relative.parent
        while parent.parts:
            expected_directories.add(parent)
            parent = parent.parent
        if entry.relative == PurePosixPath(APP_NAME):
            app_hash = item["sha256"]  # type: ignore[assignment]
    actual_files, actual_directories = _tree_inventory(output_dir, "verified flash-input export")
    if actual_files != expected_files or actual_directories != expected_directories:
        raise ReproducibilityError("verified flash-input export contains missing or extra paths")
    if not app_hash:
        raise ReproducibilityError("verified flash-input export has no application")
    return FlashIdentity(app_hash, args_hash, len(items))


def verify_rebuild(
    state_dir: Path,
    reference_build: Path,
    flash_input_copy: Path,
    target: str,
    *,
    repo: Path = REPO,
    runner: Runner = run,
) -> FlashIdentity:
    if target != "esp32s3":
        raise ReproducibilityError(f"unsupported target {target!r}; expected 'esp32s3'")
    state_dir = _canonical_external(state_dir, repo, "reproducibility state")
    reference_build = _canonical_external(reference_build, repo, "reference build directory")
    flash_input_copy = _canonical_external(flash_input_copy, repo, "flash-input copy")
    manifest = _load_manifest(state_dir)
    snapshot = state_dir / SNAPSHOT_NAME
    if _is_within(reference_build, snapshot) or _is_within(flash_input_copy, snapshot):
        raise ReproducibilityError("build and flash-input paths must not overlap the source snapshot")
    if _is_within(reference_build, flash_input_copy) or _is_within(
        flash_input_copy, reference_build
    ):
        raise ReproducibilityError("reference build and flash-input copy must be disjoint")
    _assert_tree_matches(snapshot, manifest, "golden source snapshot", exact=True)
    _assert_worktree_matches(repo.resolve(), manifest, "after reference build")

    expected_lock = next(
        (
            entry["sha256"]
            for entry in manifest["entries"]  # type: ignore[index]
            if entry["path"] == "dependencies.lock"
        ),
        None,
    )
    if expected_lock is None:
        raise ReproducibilityError("snapshot dependencies.lock identity is missing")

    clean_root = Path(tempfile.mkdtemp(prefix="clean-", dir=state_dir))
    build_source = clean_root / "source"
    build_dir = clean_root / "build"
    sdkconfig = clean_root / "sdkconfig"
    ccache_dir = clean_root / "empty-ccache"
    _copy_manifest_source(snapshot, build_source, manifest, "golden source snapshot")
    ccache_dir.mkdir()
    environment = os.environ.copy()
    environment.update(
        {
            "CCACHE_DISABLE": "1",
            "CCACHE_DIR": str(ccache_dir),
            "IDF_CCACHE_ENABLE": "0",
            "SDKCONFIG": str(sdkconfig),
        }
    )
    try:
        runner(
            [
                "idf.py",
                "-B",
                str(build_dir),
                "-D",
                f"SDKCONFIG={sdkconfig}",
                "set-target",
                target,
            ],
            build_source,
            environment,
        )
        _assert_tree_matches(snapshot, manifest, "golden source snapshot", exact=True)
        _assert_tree_matches(build_source, manifest, "clean rebuild source", exact=False)
        runner(
            [
                sys.executable,
                str(build_source / "scripts/check-sdkconfig-defaults.py"),
                str(build_source / "sdkconfig.defaults"),
                str(sdkconfig),
            ],
            build_source,
            environment,
        )
        runner(
            [
                "idf.py",
                "-B",
                str(build_dir),
                "-D",
                f"SDKCONFIG={sdkconfig}",
                "build",
            ],
            build_source,
            environment,
        )
        _assert_tree_matches(snapshot, manifest, "golden source snapshot", exact=True)
        _assert_tree_matches(build_source, manifest, "clean rebuild source", exact=False)
        _assert_worktree_matches(repo.resolve(), manifest, "after clean rebuild")
        lock, _ = _read_regular_at(
            build_source,
            PurePosixPath("dependencies.lock"),
            "clean rebuild dependencies.lock",
            MAX_SOURCE_FILE,
        )
        if _sha256_bytes(lock) != expected_lock:
            raise ReproducibilityError("dependencies.lock changed during clean rebuild")
        return compare_flash_inputs(reference_build, build_dir, flash_input_copy)
    finally:
        shutil.rmtree(clean_root, ignore_errors=True)


def _write_flash_fixture(
    build: Path,
    *,
    bootloader: bytes = b"boot",
    decimal_offsets: bool = False,
) -> None:
    (build / "bootloader").mkdir(parents=True)
    (build / "partition_table").mkdir()
    offsets = ("32768", "0", "61440", "131072") if decimal_offsets else (
        "0x8000", "0x0", "0xf000", "0x20000",
    )
    (build / "flash_args").write_text(
        "--flash-mode dio --flash-freq 80m --flash-size keep\n"
        f"{offsets[0]} partition_table/partition-table.bin\n"
        f"{offsets[1]} bootloader/bootloader.bin\n"
        f"{offsets[2]} ota_data_initial.bin\n"
        f"{offsets[3]} {APP_NAME}\n",
        encoding="utf-8",
    )
    (build / "bootloader/bootloader.bin").write_bytes(bootloader)
    (build / "partition_table/partition-table.bin").write_bytes(b"partitions")
    (build / "ota_data_initial.bin").write_bytes(b"ota-data")
    (build / APP_NAME).write_bytes(b"orchestrated deterministic app")


def _expect_failure(callable_: Callable[[], object], text: str, label: str) -> None:
    try:
        callable_()
    except ReproducibilityError as exc:
        if text not in str(exc):
            raise AssertionError(f"{label} failed for the wrong reason: {exc}") from exc
    else:
        raise AssertionError(f"self-test accepted {label}")


def self_test() -> None:
    with tempfile.TemporaryDirectory() as raw:
        root = Path(raw).resolve()
        first = root / "first.bin"
        second = root / "second.bin"
        first.write_bytes(b"same deterministic image")
        second.write_bytes(first.read_bytes())
        assert _compare_bytes(first.read_bytes(), second.read_bytes(), "unsigned app") == (
            _sha256_bytes(first.read_bytes())
        )
        second.write_bytes(b"same deterministic imagE")
        _expect_failure(
            lambda: _compare_bytes(first.read_bytes(), second.read_bytes(), "unsigned app"),
            "differs at byte",
            "different applications",
        )

        decimal_build = root / "decimal-build"
        _write_flash_fixture(decimal_build, decimal_offsets=True)
        decimal_entries = parse_flash_args_bytes((decimal_build / "flash_args").read_bytes())
        assert [entry.offset for entry in decimal_entries] == [32768, 0, 61440, 131072]
        bad_args = (
            b"--flash-mode dio --flash-freq 80m --flash-size keep\n"
            b"unexpected token\n"
            b"0x20000 daikin-altherma-esp32.bin\n"
        )
        _expect_failure(
            lambda: parse_flash_args_bytes(bad_args),
            "unknown non-option token",
            "unknown flash_args non-option token",
        )
        trailing_token_args = (
            b"--flash-mode dio unexpected --flash-freq 80m --flash-size keep\n"
            b"0x20000 daikin-altherma-esp32.bin\n"
        )
        _expect_failure(
            lambda: parse_flash_args_bytes(trailing_token_args),
            "unknown non-option token",
            "a trailing flash_args non-option token",
        )

        for case, target in (
            ("absolute", str(root / "outside-source")),
            ("parent", "../outside-source"),
        ):
            symlink_repo = root / f"symlink-{case}-repo"
            symlink_repo.mkdir()
            (symlink_repo / "dependencies.lock").write_bytes(b"locked\n")
            os.symlink(target, symlink_repo / "tracked-link")
            subprocess.run(["git", "init", "-q"], cwd=symlink_repo, check=True)
            subprocess.run(
                ["git", "-c", "core.fsmonitor=false", "add", "."],
                cwd=symlink_repo,
                check=True,
            )
            _expect_failure(
                lambda repo=symlink_repo, case=case: prepare_snapshot(
                    root / f"symlink-{case}-state", repo=repo
                ),
                "without following symlinks",
                f"tracked {case} symlink",
            )

        fixture_repo = root / "repo"
        fixture_repo.mkdir()
        (fixture_repo / "dependencies.lock").write_bytes(b"locked\n")
        (fixture_repo / "sdkconfig.defaults").write_text("CONFIG_FIXTURE=y\n")
        (fixture_repo / "version.txt").write_text("9.8.7-release.1\n")
        (fixture_repo / "scripts").mkdir()
        checker = fixture_repo / "scripts/check-sdkconfig-defaults.py"
        checker.write_text("# fixture\n")
        checker.chmod(0o755)
        subprocess.run(["git", "init", "-q"], cwd=fixture_repo, check=True)
        subprocess.run(
            ["git", "-c", "core.fsmonitor=false", "add", "."],
            cwd=fixture_repo,
            check=True,
        )

        state = root / "state"
        prepare_snapshot(state, repo=fixture_repo)
        assert (state / SNAPSHOT_NAME / "version.txt").read_text() == "9.8.7-release.1\n"
        extra = state / SNAPSHOT_NAME / "untracked-extra"
        extra.write_bytes(b"must fail exact golden inventory")

        reference_build = root / "reference-build"
        _write_flash_fixture(reference_build)
        calls: list[tuple[list[str], Path, dict[str, str]]] = []
        mutate_bootloader = False
        mutate_flash_args = False

        def mock_runner(command: list[str], cwd: Path, environment: dict[str, str]) -> None:
            calls.append((command, cwd, environment.copy()))
            assert cwd.parent.name.startswith("clean-")
            assert cwd.name == "source"
            assert environment["CCACHE_DISABLE"] == "1"
            assert environment["IDF_CCACHE_ENABLE"] == "0"
            assert Path(environment["CCACHE_DIR"]).parent == Path(environment["SDKCONFIG"]).parent
            assert not _is_within(Path(environment["SDKCONFIG"]).resolve(), fixture_repo.resolve())
            if "set-target" in command:
                Path(environment["SDKCONFIG"]).write_text("CONFIG_FIXTURE=y\n")
                (cwd / "managed_components").mkdir()
                (cwd / "managed_components/generated.txt").write_text("allowed build output\n")
            elif command[0] == "idf.py" and "build" in command:
                build = Path(command[command.index("-B") + 1])
                _write_flash_fixture(
                    build,
                    bootloader=b"changed boot" if mutate_bootloader else b"boot",
                )
                if mutate_flash_args:
                    args = build / "flash_args"
                    args.write_bytes(
                        args.read_bytes().replace(b"--flash-mode dio", b"--flash-mode qio")
                    )

        _expect_failure(
            lambda: verify_rebuild(
                state,
                reference_build,
                root / "extra-file-copy",
                "esp32s3",
                repo=fixture_repo,
                runner=mock_runner,
            ),
            "golden source snapshot tree differs",
            "an extra golden-snapshot file",
        )
        extra.unlink()

        copied = root / "reproduced-inputs"
        identity = verify_rebuild(
            state,
            reference_build,
            copied,
            "esp32s3",
            repo=fixture_repo,
            runner=mock_runner,
        )
        assert identity.input_count == 4
        assert identity.app_sha256 == _sha256_bytes((reference_build / APP_NAME).read_bytes())
        assert identity.flash_args_sha256 == _sha256_bytes(
            (reference_build / "flash_args").read_bytes()
        )
        assert assert_export_identity(copied) == identity
        assert (copied / "bootloader/bootloader.bin").read_bytes() == b"boot"
        assert len(calls) == 3

        exported_app = copied / APP_NAME
        exported_original = exported_app.read_bytes()
        exported_app.write_bytes(b"post-verification mutation")
        _expect_failure(
            lambda: assert_export_identity(copied),
            "no longer matches verified identity",
            "a post-verification app mutation",
        )
        exported_app.write_bytes(exported_original)

        external_boot = root / "external-bootloader"
        external_boot.mkdir()
        (external_boot / "bootloader.bin").write_bytes(b"boot")
        symlink_build = root / "symlink-build"
        _write_flash_fixture(symlink_build)
        shutil.rmtree(symlink_build / "bootloader")
        os.symlink(external_boot, symlink_build / "bootloader")
        _expect_failure(
            lambda: compare_flash_inputs(
                symlink_build, reference_build, root / "symlink-build-copy"
            ),
            "without following symlinks",
            "a flash input through a symlinked parent directory",
        )

        original_version = (fixture_repo / "version.txt").read_bytes()
        (fixture_repo / "version.txt").write_bytes(b"9.8.7-release.2\n")
        _expect_failure(
            lambda: verify_rebuild(
                state,
                reference_build,
                root / "must-not-exist",
                "esp32s3",
                repo=fixture_repo,
                runner=mock_runner,
            ),
            "tracked working tree after reference build changed: version.txt",
            "a post-snapshot tracked-source mutation",
        )
        (fixture_repo / "version.txt").write_bytes(original_version)

        mutate_bootloader = True
        _expect_failure(
            lambda: verify_rebuild(
                state,
                reference_build,
                root / "mutated-input-copy",
                "esp32s3",
                repo=fixture_repo,
                runner=mock_runner,
            ),
            "unsigned flash input bootloader/bootloader.bin differs",
            "a changed non-app flash input",
        )
        mutate_bootloader = False
        mutate_flash_args = True
        _expect_failure(
            lambda: verify_rebuild(
                state,
                reference_build,
                root / "mutated-flash-args-copy",
                "esp32s3",
                repo=fixture_repo,
                runner=mock_runner,
            ),
            "flash_args differs",
            "changed flash_args",
        )

        (state / SNAPSHOT_NAME / "version.txt").write_bytes(b"tampered\n")
        _expect_failure(
            lambda: verify_rebuild(
                state,
                reference_build,
                root / "tampered-snapshot-copy",
                "esp32s3",
                repo=fixture_repo,
                runner=mock_runner,
            ),
            "golden source snapshot changed: version.txt",
            "a changed source snapshot",
        )
    print("reproducible build self-test: PASS")


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    action = parser.add_mutually_exclusive_group(required=True)
    action.add_argument("--prepare", action="store_true")
    action.add_argument("--verify", action="store_true")
    action.add_argument("--assert-export", action="store_true")
    action.add_argument("--self-test", action="store_true")
    parser.add_argument("--state-dir", type=Path)
    parser.add_argument("--reference-build", type=Path)
    parser.add_argument("--flash-input-copy", type=Path)
    parser.add_argument("--repository", type=Path)
    parser.add_argument("--target")
    args = parser.parse_args(argv)
    if args.self_test:
        if (
            args.state_dir
            or args.reference_build
            or args.flash_input_copy
            or args.repository
            or args.target
        ):
            parser.error("--self-test accepts no other options")
        self_test()
        return 0
    if args.assert_export:
        if (
            args.flash_input_copy is None
            or args.state_dir
            or args.reference_build
            or args.repository
            or args.target
        ):
            parser.error("--assert-export accepts only --flash-input-copy")
        output_dir = _canonical_external(args.flash_input_copy, REPO, "flash-input copy")
        print(assert_export_identity(output_dir).app_sha256)
        return 0
    if args.state_dir is None:
        parser.error("--state-dir is required")
    if args.prepare:
        if args.reference_build or args.flash_input_copy or args.repository or args.target:
            parser.error("--prepare accepts only --state-dir")
        prepare_snapshot(args.state_dir)
        print(f"reproducible build: source snapshot prepared in {args.state_dir}")
        return 0
    if args.reference_build is None or args.flash_input_copy is None:
        parser.error("--verify requires --reference-build and --flash-input-copy")
    identity = verify_rebuild(
        args.state_dir,
        args.reference_build,
        args.flash_input_copy,
        args.target or "esp32s3",
        repo=(args.repository or REPO).resolve(),
    )
    print(
        "reproducible build: OK "
        f"({identity.input_count} unsigned flash inputs; "
        f"app SHA-256 {identity.app_sha256}; flash_args SHA-256 {identity.flash_args_sha256})"
    )
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main(sys.argv[1:]))
    except ReproducibilityError as exc:
        raise SystemExit(f"reproducible build: {exc}") from exc
