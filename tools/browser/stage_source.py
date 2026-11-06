#!/usr/bin/env python3
"""Stage current public browser inputs without exposing the worktree to a container."""

import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import stat
import subprocess
import sys


DIRECTORIES = ("main/www/", "main/def/", "main/logic/", "test/", "tools/browser/",
               "tools/ui/", "tools/web_asset/")
FILES = ("scripts/run-browser-render-tests.sh", "scripts/run-browser-tests-linux.sh",
         ".agents/skills/ui-use-case-review/SKILL.md", ".github/workflows/build.yml",
         "CMakeLists.txt", "main/CMakeLists.txt")
DENIED_SUFFIXES = frozenset((".pem", ".key", ".p12", ".pfx", ".pkcs12", ".jks", ".keystore",
                            ".env", ".bin", ".elf", ".map", ".dmp", ".dump", ".coredump", ".core", ".pcap",
                            ".pcapng", ".log", ".sqlite", ".sqlite3", ".db", ".zip", ".tar",
                            ".tgz", ".gz", ".bz2", ".xz", ".7z"))
DENIED_NAMES = frozenset((".git", ".codex", ".aws", ".ssh", ".gnupg", ".docker", ".git-credentials", ".netrc", ".npmrc", ".pypirc", "secrets.env",
                         "sdkconfig.local", "production-ota.json", "credentials.json", "core",
                         "credentials.yml", "credentials.yaml", "auth.json", "id_rsa", "id_ed25519",
                         "private", "secrets", "credentials", "dumps", "coredump", "node_modules",
                         "build", "build_mock", "managed_components"))


class StageError(Exception):
    pass


def public_path(name):
    """Apply the name allowlist before stat/open, including to tracked ignored artifacts."""
    path = PurePosixPath(name)
    if not name or path.is_absolute() or "\\" in name or any(ord(ch) < 32 for ch in name):
        raise StageError("invalid Git source path")
    if any(part in (".", "..") for part in path.parts) or str(path) != name:
        raise StageError("escaping or non-canonical Git source path")
    if name not in FILES and not any(name.startswith(prefix) for prefix in DIRECTORIES):
        raise StageError("Git returned an input outside the public browser allowlist")
    for part in path.parts:
        lowered = part.lower()
        if (lowered in DENIED_NAMES or lowered.startswith(".env") or lowered.startswith("coredump.")
                or PurePosixPath(lowered).suffix in DENIED_SUFFIXES):
            return False
    return True


def git(root, arguments, *, data=None, accepted=(0,)):
    try:
        result = subprocess.run(["git", "-c", "core.fsmonitor=false", "-C", str(root), *arguments],
                                input=data, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                check=False, timeout=30)
    except subprocess.TimeoutExpired as error:
        raise StageError("local Git source inventory timed out") from error
    if result.returncode not in accepted:
        raise StageError("local Git source inventory failed")
    return result.stdout


def open_directory(parent, name):
    info = os.stat(name, dir_fd=parent, follow_symlinks=False)
    if not stat.S_ISDIR(info.st_mode):
        raise StageError("source or destination contains a non-directory or symlink component")
    return os.open(name, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=parent)


def absolute_directory(path):
    """Walk from / with no-follow descriptors instead of resolving symlinks."""
    descriptor = os.open("/", os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        for part in path.parts[1:]:
            following = open_directory(descriptor, part)
            os.close(descriptor)
            descriptor = following
        return descriptor
    except BaseException:
        os.close(descriptor)
        raise


def checked_absolute(value):
    path = Path(value)
    if not path.is_absolute() or ".." in path.parts:
        raise StageError("source and destination must be absolute paths without traversal")
    return path


def write_all(descriptor, data):
    pending = memoryview(data)
    while pending:
        count = os.write(descriptor, pending)
        if count <= 0:
            raise StageError("public source copy made no progress")
        pending = pending[count:]


def copy_public(source, destination, name, directory_modes):
    source_parent, destination_parent = os.dup(source), os.dup(destination)
    parts = PurePosixPath(name).parts
    try:
        for index, part in enumerate(parts[:-1]):
            next_source = open_directory(source_parent, part)
            try:
                try:
                    os.mkdir(part, 0o755, dir_fd=destination_parent)
                except FileExistsError:
                    pass
                next_destination = open_directory(destination_parent, part)
            except BaseException:
                os.close(next_source)
                raise
            directory_modes["/".join(parts[:index + 1])] = stat.S_IMODE(os.fstat(next_source).st_mode)
            os.close(source_parent)
            os.close(destination_parent)
            source_parent, destination_parent = next_source, next_destination
        before = os.stat(parts[-1], dir_fd=source_parent, follow_symlinks=False)
        if not stat.S_ISREG(before.st_mode):
            raise StageError("public source input is not a regular file; symlinks are forbidden")
        source_file = os.open(parts[-1], os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=source_parent)
        try:
            current = os.fstat(source_file)
            if not stat.S_ISREG(current.st_mode) or (current.st_dev, current.st_ino) != (before.st_dev, before.st_ino):
                raise StageError("public source changed while opening the snapshot")
            target_file = os.open(parts[-1], os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW,
                                  0o600, dir_fd=destination_parent)
            digest = hashlib.sha256()
            try:
                while block := os.read(source_file, 1024 * 1024):
                    digest.update(block)
                    write_all(target_file, block)
                after = os.fstat(source_file)
                if (after.st_size, after.st_mtime_ns, after.st_ctime_ns) != (
                        current.st_size, current.st_mtime_ns, current.st_ctime_ns):
                    raise StageError("public source changed during the snapshot")
                os.fchmod(target_file, stat.S_IMODE(current.st_mode))
            finally:
                os.close(target_file)
        finally:
            os.close(source_file)
        return {"path": name, "mode": format(stat.S_IMODE(current.st_mode), "04o"),
                "sha256": digest.hexdigest()}
    finally:
        os.close(source_parent)
        os.close(destination_parent)


def stage_source(source_value, destination_value):
    root, destination = checked_absolute(source_value), checked_absolute(destination_value)
    if destination == root or root in destination.parents:
        raise StageError("browser snapshot must be outside the source worktree")
    if not hasattr(os, "O_NOFOLLOW") or not hasattr(os, "O_DIRECTORY"):
        raise StageError("no-follow directory descriptors are required")
    source = absolute_directory(root)
    parent = target = None
    try:
        top = git(root, ["rev-parse", "--show-toplevel"]).decode("utf-8").rstrip("\n")
        if top != str(root):
            raise StageError("source must be the exact physical Git worktree root")
        inventory = git(root, ["ls-files", "-c", "-o", "--exclude-standard", "-z", "--", *DIRECTORIES, *FILES])
        if inventory and not inventory.endswith(b"\0"):
            raise StageError("malformed Git source inventory")
        candidates = sorted({name.decode("utf-8") for name in inventory.split(b"\0") if name})
        candidates = [name for name in candidates if public_path(name)]
        # ls-files -c includes tracked files even when they now match .gitignore. Exclude those too.
        ignored = git(root, ["check-ignore", "--no-index", "-z", "--stdin"],
                      data=b"".join(name.encode("utf-8") + b"\0" for name in candidates), accepted=(0, 1))
        ignored_names = {name.decode("utf-8") for name in ignored.split(b"\0") if name}
        candidates = [name for name in candidates if name not in ignored_names]
        if not candidates:
            raise StageError("public browser source inventory is empty")
        parent = absolute_directory(destination.parent)
        os.mkdir(destination.name, 0o700, dir_fd=parent)
        target = open_directory(parent, destination.name)
        if os.fstat(target).st_uid != os.geteuid():
            raise StageError("browser snapshot is not owned by the caller")
        directory_modes = {}
        rows = [copy_public(source, target, name, directory_modes) for name in candidates]
        encoded = (json.dumps({"files": rows}, sort_keys=True, separators=(",", ":")) + "\n").encode("utf-8")
        manifest = os.open("browser-source-manifest.json", os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW,
                           0o600, dir_fd=target)
        try:
            write_all(manifest, encoded)
        finally:
            os.close(manifest)
        for name, mode in sorted(directory_modes.items(), key=lambda item: item[0].count("/"), reverse=True):
            descriptor = os.dup(target)
            try:
                for part in PurePosixPath(name).parts:
                    following = open_directory(descriptor, part)
                    os.close(descriptor)
                    descriptor = following
                os.fchmod(descriptor, mode)
            finally:
                os.close(descriptor)
        return {"files": len(rows), "manifest_sha256": hashlib.sha256(encoded).hexdigest()}
    finally:
        os.close(source)
        if target is not None:
            os.close(target)
        if parent is not None:
            os.close(parent)


def main(arguments):
    if len(arguments) != 2:
        print("usage: stage_source.py ABSOLUTE_SOURCE_ROOT NEW_ABSOLUTE_DESTINATION", file=sys.stderr)
        return 2
    try:
        print(json.dumps(stage_source(*arguments), sort_keys=True))
        return 0
    except (StageError, OSError, UnicodeError, ValueError):
        # A partial public snapshot on failure is not admitted; the caller owns its outer temp tree.
        print("browser source staging failed; no container may use this incomplete snapshot", file=sys.stderr)
        return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
