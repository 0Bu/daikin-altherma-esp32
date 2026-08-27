#!/usr/bin/env python3
"""Read-only, dependency-free source-format invariants for first-party C/C++."""

from __future__ import annotations

import argparse
from pathlib import Path
import re
import subprocess
import sys


SUFFIXES = {".c", ".cc", ".cpp", ".cxx", ".h", ".hh", ".hpp", ".hxx"}
CONTROL_PAREN_RE = re.compile(r"\b(if|for|while|switch|catch|return)(\s*)\(")
KEYWORD_BRACE_RE = re.compile(r"\b(else|try|do)(\s*)\{")
RAW_STRING_RE = re.compile(r'(?:u8|u|U|L)?R"([^\s\\()]{0,16})\(')
CLANG_FORMAT_VERSION_RE = re.compile(
    r"(?:^|\s)clang-format version ([0-9]+(?:\.[0-9]+){1,2})(?:\s|$)"
)
DIFF_HUNK_RE = re.compile(
    r"^@@ -[0-9]+(?:,[0-9]+)? \+([0-9]+)(?:,([0-9]+))? @@"
)


def code_projection(text: str) -> str:
    """Blank comments and literals while preserving byte positions and line boundaries."""
    projected = list(text)

    def blank(start: int, end: int) -> None:
        for position in range(start, end):
            if projected[position] != "\n":
                projected[position] = " "

    index = 0
    while index < len(text):
        if text.startswith("//", index):
            end = text.find("\n", index)
            if end < 0:
                end = len(text)
            blank(index, end)
            index = end
            continue
        if text.startswith("/*", index):
            close = text.find("*/", index + 2)
            end = len(text) if close < 0 else close + 2
            blank(index, end)
            index = end
            continue

        raw_match = RAW_STRING_RE.match(text, index)
        if raw_match:
            terminator = ")" + raw_match.group(1) + '"'
            close = text.find(terminator, raw_match.end())
            end = len(text) if close < 0 else close + len(terminator)
            blank(index, end)
            index = end
            continue

        if text[index] in {'"', "'"}:
            quote = text[index]
            end = index + 1
            while end < len(text):
                if text[end] == "\n":
                    break
                if text[end] == "\\":
                    end = min(end + 2, len(text))
                    continue
                end += 1
                if text[end - 1] == quote:
                    break
            blank(index, end)
            index = end
            continue
        index += 1
    return "".join(projected)


def eligible(path: Path, root: Path) -> bool:
    try:
        relative = path.resolve().relative_to(root.resolve())
    except ValueError:
        return False
    if path.suffix not in SUFFIXES or not relative.parts:
        return False
    if relative.parts[0] == "main":
        return len(relative.parts) >= 2 and relative.parts[1] != "def"
    return relative.parts[0] in {"test", "tools"}


def discover(root: Path, requested: list[str]) -> list[Path]:
    candidates: list[Path] = []
    if requested:
        for value in requested:
            path = Path(value)
            if not path.is_absolute():
                path = root / path
            if path.is_dir():
                candidates.extend(path.rglob("*"))
            else:
                candidates.append(path)
    else:
        for directory in (root / "main", root / "test", root / "tools"):
            if directory.is_dir():
                candidates.extend(directory.rglob("*"))

    return sorted(
        {path.resolve() for path in candidates if path.is_file() and eligible(path, root)},
        key=lambda path: path.as_posix(),
    )


def git_output(root: Path, arguments: list[str], *, text: bool = False) -> bytes | str:
    try:
        completed = subprocess.run(
            ["git", *arguments],
            cwd=root,
            check=False,
            capture_output=True,
            text=text,
        )
    except OSError as exc:
        raise ValueError(f"cannot execute git: {exc}") from exc
    if completed.returncode != 0:
        error = completed.stderr.strip()
        if isinstance(error, bytes):
            error = error.decode("utf-8", errors="replace")
        raise ValueError(f"git {' '.join(arguments)} failed: {error or completed.returncode}")
    return completed.stdout


def merge_ranges(ranges: list[tuple[int, int]]) -> list[tuple[int, int]]:
    merged: list[tuple[int, int]] = []
    for start, end in sorted(ranges):
        if merged and start <= merged[-1][1] + 1:
            merged[-1] = (merged[-1][0], max(merged[-1][1], end))
        else:
            merged.append((start, end))
    return merged


def discover_changed(
    root: Path, reference: str
) -> tuple[list[Path], dict[Path, list[tuple[int, int]]]]:
    """Return eligible changed files and their added/modified new-side line ranges."""
    raw_names = git_output(
        root,
        ["diff", "--name-only", "-z", "--diff-filter=ACMR", reference, "--"],
    )
    raw_untracked = git_output(root, ["ls-files", "--others", "--exclude-standard", "-z"])
    assert isinstance(raw_names, bytes) and isinstance(raw_untracked, bytes)
    tracked_names = {
        item.decode("utf-8") for item in raw_names.split(b"\0") if item
    }
    untracked_names = {
        item.decode("utf-8") for item in raw_untracked.split(b"\0") if item
    }
    paths = discover(root, sorted(tracked_names | untracked_names))
    line_ranges: dict[Path, list[tuple[int, int]]] = {}
    for path in paths:
        relative = path.relative_to(root).as_posix()
        if relative in untracked_names:
            line_count = path.read_bytes().count(b"\n")
            line_ranges[path] = [(1, max(1, line_count))]
            continue

        patch = git_output(
            root,
            ["diff", "--unified=0", "--no-color", reference, "--", relative],
            text=True,
        )
        assert isinstance(patch, str)
        ranges: list[tuple[int, int]] = []
        for line in patch.splitlines():
            match = DIFF_HUNK_RE.match(line)
            if not match:
                continue
            start = int(match.group(1))
            count = int(match.group(2)) if match.group(2) is not None else 1
            if count > 0:
                ranges.append((start, start + count - 1))
        if ranges:
            line_ranges[path] = merge_ranges(ranges)
    return paths, line_ranges


def validate_clang_format(command: str, expected_version: str, root: Path) -> bool:
    try:
        version = subprocess.run(
            [command, "--version"],
            cwd=root,
            check=False,
            capture_output=True,
            text=True,
        )
    except OSError as exc:
        print(f"format check: cannot execute {command}: {exc}", file=sys.stderr)
        return False
    version_text = (version.stdout + version.stderr).strip()
    version_match = CLANG_FORMAT_VERSION_RE.search(version_text)
    if (
        version.returncode != 0
        or version_match is None
        or version_match.group(1) != expected_version
    ):
        observed = version_match.group(1) if version_match else version_text or "unknown"
        print(
            f"format check: expected clang-format {expected_version}, got {observed}",
            file=sys.stderr,
        )
        return False
    return True


def check_file(path: Path, root: Path) -> list[str]:
    relative = path.resolve().relative_to(root.resolve()).as_posix()
    data = path.read_bytes()
    findings: list[str] = []
    if data.startswith(b"\xef\xbb\xbf"):
        findings.append(f"{relative}:1: UTF-8 BOM is not allowed")
    if b"\r" in data:
        line = data[: data.index(b"\r")].count(b"\n") + 1
        findings.append(f"{relative}:{line}: CR/CRLF line ending is not allowed")
    text: str | None = None
    try:
        text = data.decode("utf-8")
    except UnicodeDecodeError as exc:
        line = data[: exc.start].count(b"\n") + 1
        findings.append(f"{relative}:{line}: source is not valid UTF-8")
    if not data:
        findings.append(f"{relative}:1: empty source file")
        return findings
    if not data.endswith(b"\n"):
        findings.append(f"{relative}:{data.count(b'\n') + 1}: missing final newline")
    elif data.endswith(b"\n\n"):
        findings.append(f"{relative}:{data.count(b'\n')}: duplicate final newline")
    for line_number, line in enumerate(data.splitlines(), start=1):
        if b"\t" in line:
            findings.append(f"{relative}:{line_number}: tab character violates UseTab: Never")
        if line.endswith((b" ", b"\t")):
            findings.append(f"{relative}:{line_number}: trailing whitespace")

    if text is not None:
        for line_number, line in enumerate(code_projection(text).splitlines(), start=1):
            stripped = line.lstrip(" ")
            indentation = len(line) - len(stripped)
            if stripped and not stripped.startswith("#") and 0 < indentation < 4:
                findings.append(
                    f"{relative}:{line_number}: indentation must start at four spaces"
                )
            for match in CONTROL_PAREN_RE.finditer(line):
                if match.group(2) != " ":
                    findings.append(
                        f"{relative}:{line_number}: {match.group(1)} requires one space before ("
                    )
            for match in KEYWORD_BRACE_RE.finditer(line):
                if match.group(2) != " ":
                    findings.append(
                        f"{relative}:{line_number}: {match.group(1)} requires one space before {{"
                    )
            if ";}" in line:
                findings.append(f"{relative}:{line_number}: missing space or newline before }}")
    return findings


def main() -> int:
    parser = argparse.ArgumentParser(
        description=(
            "Check first-party main/, test/ and tools/ C/C++ formatting without rewriting files; "
            "main/def is generated and excluded"
        )
    )
    parser.add_argument("paths", nargs="*", help="optional files/directories below the root")
    parser.add_argument("--root", type=Path, default=Path.cwd(), help="repository root")
    parser.add_argument(
        "--clang-format",
        metavar="COMMAND",
        help="also run COMMAND --dry-run --Werror --style=file over the eligible files",
    )
    parser.add_argument(
        "--clang-format-version",
        help="exact version required from COMMAND --version",
    )
    parser.add_argument(
        "--changed-since",
        metavar="GIT_REF",
        help="check clang-format only on added/modified new-side lines since GIT_REF",
    )
    args = parser.parse_args()
    root = args.root.resolve()
    if not root.is_dir():
        parser.error(f"--root is not a directory: {root}")

    if args.changed_since and args.paths:
        parser.error("--changed-since cannot be combined with explicit paths")
    if bool(args.clang_format) != bool(args.clang_format_version):
        parser.error("--clang-format and --clang-format-version must be supplied together")
    if args.changed_since and not args.clang_format:
        parser.error("--changed-since requires --clang-format")
    if args.clang_format and not validate_clang_format(
        args.clang_format, args.clang_format_version, root
    ):
        return 2

    try:
        if args.changed_since:
            files, line_ranges = discover_changed(root, args.changed_since)
        else:
            files = discover(root, args.paths)
            line_ranges = {}
    except (OSError, UnicodeError, ValueError) as exc:
        print(f"format check: cannot determine changed lines: {exc}", file=sys.stderr)
        return 2
    if not files:
        if args.changed_since:
            print("format check: no changed first-party C/C++ files")
            return 0
        print("format check: no eligible first-party C/C++ files found", file=sys.stderr)
        return 2

    findings: list[str] = []
    for path in files:
        try:
            findings.extend(check_file(path, root))
        except OSError as exc:
            findings.append(f"{path}: cannot read: {exc}")
    if findings:
        print("\n".join(findings), file=sys.stderr)
        print(f"format check: {len(findings)} violation(s)", file=sys.stderr)
        return 1

    if args.clang_format:
        failed = False
        formatted_files = 0
        for path in files:
            ranges = line_ranges.get(path) if args.changed_since else None
            if args.changed_since and not ranges:
                continue
            command = [
                args.clang_format,
                "--dry-run",
                "--Werror",
                "--style=file",
            ]
            if ranges:
                command.extend(f"--lines={start}:{end}" for start, end in ranges)
            command.append(str(path))
            try:
                completed = subprocess.run(command, cwd=root, check=False)
            except OSError as exc:
                print(
                    f"format check: cannot execute {args.clang_format}: {exc}",
                    file=sys.stderr,
                )
                return 2
            formatted_files += 1
            failed = failed or completed.returncode != 0
        if failed:
            print("format check: clang-format reported style drift", file=sys.stderr)
            return 1
        if args.changed_since:
            print(
                f"format check: clang-format checked changed lines in {formatted_files} file(s)"
            )

    suffix = " plus clang-format" if args.clang_format else ""
    print(f"format check: {len(files)} first-party C/C++ files pass portable invariants{suffix}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
