#!/usr/bin/env python3
"""Hydrate the historical source needed by offline/read-only CI.

Keep full commits, trees and tags in a blob-filtered checkout. Only the HTTP deadline witness
needs eager materialization. Historical firmware and GIF binaries remain lazy.
"""
from __future__ import annotations

import argparse
from pathlib import Path
import re
import subprocess


ROOT = Path(__file__).resolve().parents[1]


class HistoryError(ValueError):
    """A required historical input could not be established."""


def git(*arguments: str, capture: bool = True) -> bytes:
    result = subprocess.run(
        ["git", "-c", "core.fsmonitor=false", "-C", str(ROOT), *arguments],
        stdout=subprocess.PIPE if capture else subprocess.DEVNULL,
        stderr=subprocess.PIPE, check=False, timeout=120,
    )
    if result.returncode:
        detail = result.stderr.decode("utf-8", errors="replace").strip()
        raise HistoryError(f"git {' '.join(arguments)} failed: {detail or result.returncode}")
    return result.stdout if capture else b""


def source_text(path: str, source_tree: str | None) -> str:
    if source_tree:
        return git("show", f"{source_tree}:{path}").decode("utf-8")
    return (ROOT / path).read_text(encoding="utf-8")


def http_deadline_witness(source_tree: str | None) -> str:
    source = source_text("test/test_http_deadline_runtime.mjs", source_tree)
    pins = re.findall(r'^const originalCommit = "([0-9a-f]{40})";$', source, re.MULTILINE)
    read = 'execute("git", ["-c", "core.fsmonitor=false", "show", `${originalCommit}:main/http_deadline.cpp`])'
    if len(pins) != 1 or source.count(read) != 1:
        raise HistoryError("HTTP deadline runtime historical read changed; review its hydration contract")
    return pins[0] + ":main/http_deadline.cpp"


def hydrate(revision: str, path: str) -> None:
    # ls-tree consults metadata, so absent files are distinguishable from promised missing blobs.
    git("rev-parse", "--verify", revision + "^{commit}")
    entries = git("ls-tree", "-z", revision, "--", path).split(b"\0")
    entries = [entry for entry in entries if entry]
    if len(entries) != 1:
        raise HistoryError(f"required historical input is absent: {revision}:{path}")
    metadata, separator, found_path = entries[0].partition(b"\t")
    fields = metadata.split()
    if not separator or found_path != path.encode() or len(fields) != 3 \
            or fields[:2] != [b"100644", b"blob"] \
            or not re.fullmatch(rb"[0-9a-f]{40}", fields[2]):
        raise HistoryError(f"historical input is not one regular source blob: {revision}:{path}")
    # cat-file performs the lazy fetch now, while this host's object database is writable.
    git("cat-file", "blob", fields[2].decode("ascii"), capture=False)
    print(f"CI history: hydrated {revision}:{path}")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source-tree", help="read the runtime witness pin from this Git tree")
    args = parser.parse_args()
    if args.source_tree is not None and not re.fullmatch(r"[0-9a-f]{40}", args.source_tree):
        raise HistoryError("--source-tree requires a full SHA")
    if git("rev-parse", "--is-shallow-repository").strip() != b"false":
        raise HistoryError("full commit history and tags are required; shallow checkout refused")
    revision, path = http_deadline_witness(args.source_tree).split(":", 1)
    hydrate(revision, path)
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (HistoryError, OSError, subprocess.TimeoutExpired) as exc:
        raise SystemExit(f"CI history: {exc}") from exc
