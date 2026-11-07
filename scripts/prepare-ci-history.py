#!/usr/bin/env python3
"""Hydrate the historical source blobs needed by offline/read-only CI consumers.

Keep full commits, trees and tags in a blob-filtered checkout. Only these source witnesses need
eager materialization; historical firmware/GIF binaries need not be downloaded with them.
"""
from __future__ import annotations

import ast
from pathlib import Path
import re
import subprocess
import sys


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


def http_witness() -> str:
    """Read the existing runtime-test pin without executing the test or duplicating that pin."""
    source = ROOT / "test/http_config_runtime/run.py"
    tree = ast.parse(source.read_text(encoding="utf-8"), filename=str(source))
    assignments = {
        name: [node.value for node in tree.body if isinstance(node, ast.Assign)
               and any(isinstance(target, ast.Name) and target.id == name
                       for target in node.targets)]
        for name in ("original_commit", "original_text")
    }
    pins = assignments["original_commit"]
    if len(pins) != 1 or not isinstance(pins[0], ast.Constant) or not isinstance(pins[0].value, str) \
            or not re.fullmatch(r"[0-9a-f]{40}", pins[0].value):
        raise HistoryError("HTTP runtime test must declare one literal full original_commit")
    expected = ast.parse(
        "command(['git', '-c', 'core.fsmonitor=false', '-C', ROOT, 'show', "
        "original_commit + ':main/http_config.cpp']).stdout", mode="eval",
    ).body
    reads = assignments["original_text"]
    if len(reads) != 1 or ast.dump(reads[0]) != ast.dump(expected):
        raise HistoryError("HTTP runtime historical read changed; review its hydration contract")
    return pins[0].value + ":main/http_config.cpp"


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
    if len(sys.argv) != 1:
        raise HistoryError("no arguments expected")
    if git("rev-parse", "--is-shallow-repository").strip() != b"false":
        raise HistoryError("full commit history and tags are required; shallow checkout refused")
    witness = http_witness()
    revision, path = witness.split(":", 1)
    hydrate(revision, path)
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (HistoryError, OSError, SyntaxError, subprocess.TimeoutExpired) as exc:
        raise SystemExit(f"CI history: {exc}") from exc
