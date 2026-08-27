#!/usr/bin/env python3
"""Enforce line coverage and per-file branch-outcome ratchets from gcov output."""

from __future__ import annotations

import argparse
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
import json
from pathlib import Path, PurePosixPath
import re
import sys
from typing import Any


FILE_RE = re.compile(r"^File '(.+)'$")
LINES_RE = re.compile(r"^Lines executed:([0-9]+(?:\.[0-9]+)?)% of ([0-9]+)$")
BRANCHES_TAKEN_RE = re.compile(
    r"^Taken at least once:([0-9]+(?:\.[0-9]+)?)% of ([0-9]+)$"
)


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


def parse_branch_report(lines: list[str]) -> dict[str, tuple[int, int]]:
    """Return compiler branch outcomes as exact (taken, total) counts per logic header."""
    result: dict[str, tuple[int, int]] = {}
    source: str | None = None

    for raw in lines:
        line = raw.strip()
        file_match = FILE_RE.match(line)
        if file_match:
            source = file_match.group(1)
            continue

        branch_match = BRANCHES_TAKEN_RE.match(line)
        if not branch_match or source is None:
            continue

        canonical = logic_source(source)
        if canonical is not None:
            percent = Decimal(branch_match.group(1))
            outcomes = int(branch_match.group(2))
            if outcomes > 0:
                if percent > 100:
                    raise ValueError(
                        f"invalid gcov branch percentage for {canonical}: {percent}%"
                    )
                # gcov emits a two-decimal summary rather than the numerator. The production
                # profiles are small enough that rounding the implied count recovers that exact
                # integer. Persisting both integers binds compiler instrumentation as well as the
                # displayed ratio; an unchanged "80.00%" with a different denominator must fail.
                taken = int(
                    (percent * outcomes / Decimal(100)).quantize(
                        Decimal("1"), rounding=ROUND_HALF_UP
                    )
                )
                rounded = (
                    Decimal(taken) * Decimal(100) / Decimal(outcomes)
                ).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
                if percent.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP) != rounded:
                    raise ValueError(
                        f"inconsistent gcov branch summary for {canonical}: "
                        f"{percent}% of {outcomes} cannot represent an integer outcome count"
                    )
                result[canonical] = (taken, outcomes)
        source = None

    return result


def load_branch_baseline(
    path: Path, profile: str, *, profile_required: bool = True
) -> dict[str, tuple[int, int]]:
    """Load exact per-file taken/outcome counts for one compiler profile."""
    try:
        document: Any = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError) as exc:
        raise ValueError(f"cannot read branch baseline {path}: {exc}") from exc

    if not isinstance(document, dict) or document.get("schema") != 3:
        raise ValueError("branch baseline must be an object with schema 3")
    profiles = document.get("profiles")
    if not isinstance(profiles, dict) or not profiles:
        raise ValueError("branch baseline profiles must be a non-empty object")
    raw_expectations = profiles.get(profile)
    if raw_expectations is None and not profile_required:
        return {}
    if not isinstance(raw_expectations, dict) or not raw_expectations:
        raise ValueError(f"branch baseline has no non-empty profile {profile!r}")

    expectations: dict[str, tuple[int, int]] = {}
    for source, raw_expectation in raw_expectations.items():
        relative = (
            PurePosixPath(source.removeprefix("main/logic/"))
            if isinstance(source, str)
            else None
        )
        if (
            not isinstance(source, str)
            or not source.startswith("main/logic/")
            or relative is None
            or relative.is_absolute()
            or ".." in relative.parts
            or source != f"main/logic/{relative.as_posix()}"
            or not source.endswith(".hpp")
        ):
            raise ValueError(f"invalid branch baseline source: {source!r}")
        if (
            not isinstance(raw_expectation, dict)
            or set(raw_expectation) != {"taken", "outcomes"}
        ):
            raise ValueError(
                f"branch expectation for {source} must contain only taken and outcomes"
            )
        taken = raw_expectation["taken"]
        outcomes = raw_expectation["outcomes"]
        if (
            isinstance(taken, bool)
            or not isinstance(taken, int)
            or isinstance(outcomes, bool)
            or not isinstance(outcomes, int)
            or outcomes <= 0
            or taken < 0
            or taken > outcomes
        ):
            raise ValueError(
                f"branch expectation for {source} needs 0 <= taken <= outcomes and outcomes > 0"
            )
        expectations[source] = (taken, outcomes)
    return expectations


def branch_percent(counts: tuple[int, int]) -> Decimal:
    taken, outcomes = counts
    return Decimal(taken) * Decimal(100) / Decimal(outcomes)


def check_baseline_monotonic(
    current: dict[str, tuple[int, int]], reference: dict[str, tuple[int, int]]
) -> bool:
    """Reject a reviewed profile whose coverage ratio was lowered from repository history."""
    lowered: list[str] = []
    for source in sorted(current.keys() & reference.keys()):
        taken, outcomes = current[source]
        old_taken, old_outcomes = reference[source]
        if taken * old_outcomes < old_taken * outcomes:
            lowered.append(
                f"{source}: {taken}/{outcomes} ({branch_percent(current[source]):.2f}%) "
                f"is below {old_taken}/{old_outcomes} "
                f"({branch_percent(reference[source]):.2f}%)"
            )
    if lowered:
        print(
            "logic branch coverage: versioned profile may only move upward:\n  "
            + "\n  ".join(lowered),
            file=sys.stderr,
        )
        return False
    return True


def check_branch_ratchet(
    branches: dict[str, tuple[int, int]], expectations: dict[str, tuple[int, int]]
) -> bool:
    """Fail closed unless every branch-bearing file exactly matches its reviewed counts."""
    branch_sources = set(branches)
    baseline_sources = set(expectations)
    missing = sorted(baseline_sources - branch_sources)
    untracked = sorted(branch_sources - baseline_sources)
    if missing:
        print(
            "logic branch coverage: baseline source(s) absent from gcov branch report:\n  "
            + "\n  ".join(missing),
            file=sys.stderr,
        )
    if untracked:
        print(
            "logic branch coverage: branch-bearing source(s) have no reviewed baseline:\n  "
            + "\n  ".join(untracked),
            file=sys.stderr,
        )

    regressions: list[str] = []
    improvements: list[str] = []
    instrumentation_changes: list[str] = []
    for source in sorted(branch_sources & baseline_sources):
        actual = branches[source]
        expected = expectations[source]
        if actual == expected:
            continue
        taken, outcomes = actual
        expected_taken, expected_outcomes = expected
        if outcomes != expected_outcomes:
            instrumentation_changes.append(
                f"{source}: observed {taken}/{outcomes} outcomes, expected "
                f"{expected_taken}/{expected_outcomes}"
            )
        elif taken < expected_taken:
            regressions.append(
                f"{source}: {taken}/{outcomes} ({branch_percent(actual):.2f}%), expected "
                f"{expected_taken}/{expected_outcomes} ({branch_percent(expected):.2f}%)"
            )
        else:
            improvements.append(
                f"{source}: {taken}/{outcomes} ({branch_percent(actual):.2f}%), baseline "
                f"{expected_taken}/{expected_outcomes} ({branch_percent(expected):.2f}%)"
            )
    if regressions:
        print(
            "logic branch coverage: per-file outcome ratchet regressed:\n  "
            + "\n  ".join(regressions),
            file=sys.stderr,
        )
    if improvements:
        print(
            "logic branch coverage: improvement(s) must raise the versioned profile so they "
            "cannot be lost later:\n  "
            + "\n  ".join(improvements),
            file=sys.stderr,
        )
    if instrumentation_changes:
        print(
            "logic branch coverage: compiler outcome inventory changed; review and update the "
            "exact taken/outcomes profile:\n  "
            + "\n  ".join(instrumentation_changes),
            file=sys.stderr,
        )

    if (
        missing
        or untracked
        or regressions
        or improvements
        or instrumentation_changes
        or not branches
    ):
        if not branches:
            print("logic branch coverage: gcov reported no branch outcomes", file=sys.stderr)
        return False

    print(
        f"logic branch outcome ratchet: {len(branches)} files exactly match the versioned "
        "compiler profile"
    )
    return True


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
    parser.add_argument(
        "--branch-baseline",
        type=Path,
        help=(
            "JSON file containing reviewed exact per-header taken/outcome counts; when supplied, "
            "missing, changed and newly branch-bearing headers fail closed"
        ),
    )
    parser.add_argument(
        "--branch-profile",
        help="compiler-family/major profile in --branch-baseline",
    )
    parser.add_argument(
        "--branch-baseline-reference",
        type=Path,
        action="append",
        default=[],
        help=(
            "historical baseline whose selected profile may not be lowered (repeatable); a "
            "missing profile permits introduction of a new compiler profile"
        ),
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
        f"main/logic/{path.relative_to(args.source_dir).as_posix()}"
        for path in args.source_dir.rglob("*.hpp")
        if path.name not in args.exclude
    }
    report = list(sys.stdin)
    sources = parse_report(report)
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

    if args.branch_baseline is not None:
        if not args.branch_profile:
            print(
                "logic branch coverage: --branch-profile is required with --branch-baseline",
                file=sys.stderr,
            )
            return 2
        try:
            expectations = load_branch_baseline(args.branch_baseline, args.branch_profile)
            references = [
                load_branch_baseline(path, args.branch_profile, profile_required=False)
                for path in args.branch_baseline_reference
            ]
        except ValueError as exc:
            print(f"logic branch coverage: {exc}", file=sys.stderr)
            return 2
        if any(
            not check_baseline_monotonic(expectations, reference)
            for reference in references
        ):
            return 1
        try:
            branches = parse_branch_report(report)
        except ValueError as exc:
            print(f"logic branch coverage: {exc}", file=sys.stderr)
            return 1
        if not check_branch_ratchet(branches, expectations):
            return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
