#!/usr/bin/env python3
"""Synthetic Git fixtures for the browser container's source boundary."""

import importlib.util
import json
import os
from pathlib import Path
import stat
import subprocess
import sys
import tempfile
from unittest import mock


SCRIPT = Path(__file__).with_name("stage_source.py")
SPEC = importlib.util.spec_from_file_location("browser_stage_source", SCRIPT)
STAGE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(STAGE)


def git(root, *arguments):
    subprocess.run(["git", "-c", "core.fsmonitor=false", "-C", str(root), *arguments],
                   check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)


def put(root, name, content="synthetic public fixture\n", mode=0o644):
    path = root / name
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content)
    path.chmod(mode)


def refused(root, destination):
    try:
        STAGE.stage_source(root, destination)
    except (STAGE.StageError, OSError):
        return
    raise AssertionError("invalid staging input was admitted")


def main():
    with tempfile.TemporaryDirectory(prefix="daikin-browser-stage-selftest-") as temporary:
        work = Path(temporary).resolve()
        root = work / "source"
        root.mkdir()
        git(root, "init", "-q")
        put(root, "main/www/app.js", "tracked initial bytes\n", 0o755)
        put(root, "scripts/run-browser-render-tests.sh", "#!/bin/sh\nexit 0\n", 0o755)
        git(root, "add", "main/www/app.js", "scripts/run-browser-render-tests.sh")
        put(root, "main/www/app.js", "tracked current dirty bytes\n", 0o750)
        put(root, "tools/browser/new_runner.mjs", "new nonignored working bytes\n")
        put(root, "test/ignored.js", "synthetic ignored sentinel\n")
        put(root, "test/tracked_ignored.js", "synthetic tracked ignored sentinel\n")
        put(root, ".gitignore", "test/ignored.js\ntest/tracked_ignored.js\n")
        git(root, "add", "--force", "test/tracked_ignored.js")
        put(root, "test/secrets.env", "synthetic forbidden-name sentinel, no credentials\n")
        put(root, "test/.env", "synthetic forbidden-name sentinel, no credentials\n")
        put(root, "test/raw.bin", "synthetic forbidden artifact sentinel\n")
        put(root, "unrelated/outside.txt", "synthetic outside-allowlist sentinel\n")
        actual_open = os.open

        def guard_open(name, *arguments, **keywords):
            assert os.fspath(name) not in ("secrets.env", ".env", "raw.bin", "ignored.js", "tracked_ignored.js",
                                            "public_link.js", "linked-directory", "linked-parent", "source-link", "target.js"), \
                "an excluded sentinel or synthetic symlink target must never be opened"
            return actual_open(name, *arguments, **keywords)

        snapshot = work / "snapshot"
        with mock.patch.object(STAGE.os, "open", guard_open):
            result = STAGE.stage_source(root, snapshot)
        assert result["files"] == 3
        assert (snapshot / "main/www/app.js").read_text() == "tracked current dirty bytes\n"
        assert stat.S_IMODE((snapshot / "main/www/app.js").stat().st_mode) == 0o750
        assert (snapshot / "tools/browser/new_runner.mjs").read_text() == "new nonignored working bytes\n"
        assert not (snapshot / ".git").exists() and not (snapshot / "unrelated").exists()
        paths = {row["path"] for row in json.loads((snapshot / "browser-source-manifest.json").read_text())["files"]}
        assert paths == {"main/www/app.js", "scripts/run-browser-render-tests.sh", "tools/browser/new_runner.mjs"}
        assert stat.S_IMODE(snapshot.stat().st_mode) == 0o700
        for forbidden in ("test/example.pem", "test/example.key", "test/example.elf", "test/dumps/data.js",
                          "test/raw.dump", "test/raw.coredump", "test/.ssh/id_rsa", "test/.aws/config",
                          "test/auth.json", "test/.npmrc"):
            assert not STAGE.public_path(forbidden), "artifact/key names must be rejected without opening a file"
        refused(root, snapshot)
        refused(root, root / "inside")
        refused(root / "main", work / "wrong-root")
        linked_parent = work / "linked-parent"
        linked_parent.symlink_to(work, target_is_directory=True)
        source_link = work / "source-link"
        source_link.symlink_to(root, target_is_directory=True)
        with mock.patch.object(STAGE.os, "open", guard_open):
            refused(root, linked_parent / "bad-destination")
            refused(source_link, work / "linked-source")

        outside = work / "outside"
        outside.mkdir()
        put(outside, "target.js", "synthetic outside sentinel must not be opened\n")
        (root / "test/public_link.js").symlink_to(outside / "target.js")
        with mock.patch.object(STAGE.os, "open", guard_open):
            refused(root, work / "leaf-symlink")
        (root / "test/public_link.js").unlink()
        (root / "test/linked-directory").symlink_to(outside, target_is_directory=True)
        with mock.patch.object(STAGE.os, "open", guard_open):
            refused(root, work / "directory-symlink")
        (root / "test/linked-directory").unlink()

        with mock.patch.object(STAGE.subprocess, "run", side_effect=FileNotFoundError("synthetic missing Git")):
            refused(root, work / "missing-git")
        original_git = STAGE.git

        def escaping_git(source, arguments, **keywords):
            if arguments[0] == "ls-files":
                return b"test/../../outside/target.js\0"
            return original_git(source, arguments, **keywords)

        with mock.patch.object(STAGE, "git", escaping_git):
            refused(root, work / "escaping-git-path")
        with mock.patch.object(STAGE.os, "read", side_effect=OSError("synthetic copy failure")):
            refused(root, work / "copy-failure")

        invalid = subprocess.run([sys.executable, str(SCRIPT), str(root), str(snapshot)],
                                 stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=False)
        assert invalid.returncode == 2 and b"incomplete snapshot" in invalid.stderr
        missing = subprocess.run([sys.executable, str(SCRIPT), str(work / "missing"), str(work / "unused")],
                                 stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=False)
        assert missing.returncode == 2
    print("browser source staging selftest passed: current dirty/untracked bytes, ignore/privacy names, modes, no-follow paths, Git/copy failures")


if __name__ == "__main__":
    main()
