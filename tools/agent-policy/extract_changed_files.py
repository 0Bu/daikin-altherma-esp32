#!/usr/bin/env python3
"""Validate GitHub's paginated PR-file response and emit one complete filename list."""

from __future__ import annotations

import json
from pathlib import Path
import sys


def fail(message: str) -> int:
    print(f"agent policy: {message}", file=sys.stderr)
    return 2


def main() -> int:
    if len(sys.argv) != 3:
        return fail("expected changed_files count and a --slurp API response file")
    try:
        expected = int(sys.argv[1])
    except ValueError:
        return fail("PR changed_files is not an integer")
    if expected < 0:
        return fail("PR changed_files must not be negative")
    if expected > 3000:
        return fail("GitHub exposes at most 3000 PR files; refusing a partial changed-file list")
    try:
        pages = json.loads(Path(sys.argv[2]).read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError) as exc:
        return fail(f"PR files response is unreadable or invalid JSON: {exc}")
    if not isinstance(pages, list) or any(not isinstance(page, list) for page in pages):
        return fail("PR files response is not the expected paginated array")
    records = [record for page in pages for record in page]
    if len(records) != expected:
        return fail(
            f"PR files response count mismatch: metadata says {expected}, API returned {len(records)}"
        )
    filenames: list[str] = []
    seen: set[str] = set()
    for record in records:
        filename = record.get("filename") if isinstance(record, dict) else None
        if not isinstance(filename, str) or not filename or "\n" in filename or "\r" in filename:
            return fail("PR files response contains a missing or line-unsafe filename")
        previous = record.get("previous_filename")
        if previous is not None and (
            not isinstance(previous, str)
            or not previous
            or "\n" in previous
            or "\r" in previous
        ):
            return fail("PR files response contains a line-unsafe previous filename")
        for path in (filename, previous):
            if path is not None and path not in seen:
                filenames.append(path)
                seen.add(path)
    sys.stdout.write("".join(f"{filename}\n" for filename in filenames))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
