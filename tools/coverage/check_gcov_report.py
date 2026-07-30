#!/usr/bin/env python3
"""Enforce aggregate executable-line coverage for main/logic from gcov output."""

from __future__ import annotations

import argparse
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
from pathlib import Path
import re
import sys


FILE_RE = re.compile(r"^File '(.+)'$")
LINES_RE = re.compile(r"^Lines executed:([0-9]+(?:\.[0-9]+)?)% of ([0-9]+)$")


def logic_source(path: str) -> str | None:
    normalized = path.replace("\\", "/")
    marker = "main/logic/"
    pos = normalized.find(marker)
    return normalized[pos:] if pos >= 0 else None


def parse_report(lines: list[str]) -> dict[str, tuple[int, int]]:
    result: dict[str, tuple[int, int]] = {}
    source: str | None = None

    for raw in lines:
        line = raw.strip()
        file_match = FILE_RE.match(line)
        if file_match:
            source = file_match.group(1)
            continue

        line_match = LINES_RE.match(line)
        if not line_match or source is None:
            continue

        canonical = logic_source(source)
        if canonical is not None:
            percent = Decimal(line_match.group(1))
            executable = int(line_match.group(2))
            covered = int(
                (percent * executable / Decimal(100)).quantize(
                    Decimal("1"), rounding=ROUND_HALF_UP
                )
            )
            result[canonical] = (min(covered, executable), executable)
        source = None

    return result


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Enforce aggregate executable-line coverage under main/logic/"
    )
    parser.add_argument(
        "--minimum",
        default="95",
        help="minimum aggregate line coverage percentage (default: 95)",
    )
    parser.add_argument(
        "--source-dir",
        type=Path,
        default=Path("main/logic"),
        help="directory whose .hpp inventory must appear in the report",
    )
    parser.add_argument(
        "--exclude",
        action="append",
        default=[],
        metavar="BASENAME",
        help="non-executable header basename to omit from the inventory (repeatable)",
    )
    args = parser.parse_args()

    try:
        minimum = Decimal(args.minimum)
    except InvalidOperation:
        parser.error("--minimum must be a number")
    if minimum < 0 or minimum > 100:
        parser.error("--minimum must be between 0 and 100")

    if not args.source_dir.is_dir():
        parser.error(f"--source-dir is not a directory: {args.source_dir}")

    expected = {
        f"main/logic/{path.name}"
        for path in args.source_dir.glob("*.hpp")
        if path.name not in args.exclude
    }
    sources = parse_report(list(sys.stdin))
    missing = sorted(expected - sources.keys())
    if missing:
        print(
            "logic coverage: source file(s) absent from gcov report:\n  "
            + "\n  ".join(missing),
            file=sys.stderr,
        )
        return 1

    executable = sum(total for _, total in sources.values())
    covered = sum(hit for hit, _ in sources.values())
    if not sources or executable == 0:
        print(
            "logic coverage: gcov reported no executable lines under main/logic/",
            file=sys.stderr,
        )
        return 1

    percent = Decimal(covered) * Decimal(100) / Decimal(executable)
    print(
        f"logic line coverage: {percent:.2f}% "
        f"({covered}/{executable} across {len(sources)} files; minimum {minimum:.2f}%)"
    )
    if percent < minimum:
        print(
            f"logic coverage: {percent:.2f}% is below the {minimum:.2f}% minimum",
            file=sys.stderr,
        )
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
