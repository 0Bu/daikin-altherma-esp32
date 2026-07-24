#!/usr/bin/env python3
"""Reject ESP Web Tools manifests whose writes can erase the NVS partition."""

from __future__ import annotations

import csv
import json
import sys
from pathlib import Path


FLASH_SECTOR_SIZE = 0x1000


def fail(message: str) -> None:
    raise SystemExit(f"web installer plan: {message}")


def partition_geometry(path: Path, name: str) -> tuple[int, int]:
    try:
        with path.open(newline="", encoding="utf-8") as handle:
            for row in csv.reader(line for line in handle if not line.lstrip().startswith("#")):
                if not row or row[0].strip() != name:
                    continue
                try:
                    offset, size = int(row[3].strip(), 0), int(row[4].strip(), 0)
                except (IndexError, ValueError) as exc:
                    fail(f"invalid {name!r} row in {path}: {exc}")
                if offset < 0 or size <= 0:
                    fail(f"invalid {name!r} geometry in {path}: offset={offset}, size={size}")
                return offset, size
    except OSError as exc:
        fail(f"cannot read {path}: {exc}")
    fail(f"partition {name!r} not found in {path}")


def main() -> None:
    if len(sys.argv) != 3:
        fail(f"usage: {Path(sys.argv[0]).name} MANIFEST PARTITIONS_CSV")

    manifest_path = Path(sys.argv[1])
    partitions_path = Path(sys.argv[2])
    try:
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError) as exc:
        fail(f"cannot read {manifest_path}: {exc}")
    if not isinstance(manifest, dict):
        fail(f"{manifest_path} must contain a JSON object")
    if manifest.get("new_install_prompt_erase") is not True:
        fail("new_install_prompt_erase must be true so the user can decline a whole-chip erase")
    builds = manifest.get("builds")
    if not isinstance(builds, list) or not builds:
        fail(f"{manifest_path} has no builds")

    nvs_start, nvs_size = partition_geometry(partitions_path, "nvs")
    nvs_end = nvs_start + nvs_size
    checked = 0

    for build in builds:
        if not isinstance(build, dict):
            fail(f"invalid build entry: {build!r}")
        family = build.get("chipFamily", "<unknown>")
        parts = build.get("parts")
        if not isinstance(parts, list) or not parts:
            fail(f"{family} has no flash parts")

        for part in parts:
            if not isinstance(part, dict):
                fail(f"{family} has an invalid part entry: {part!r}")
            relative_path = part.get("path")
            offset = part.get("offset")
            if (
                not isinstance(relative_path, str)
                or not relative_path
                or not isinstance(offset, int)
                or isinstance(offset, bool)
                or offset < 0
            ):
                fail(f"{family} has an invalid part entry: {part!r}")

            part_path = Path(relative_path)
            if part_path.is_absolute() or ".." in part_path.parts:
                fail(f"{family} part escapes the manifest directory: {relative_path!r}")
            image_path = manifest_path.parent / part_path
            try:
                stat = image_path.stat()
            except OSError as exc:
                fail(f"{family} part cannot be read: {image_path}: {exc}")
            if not image_path.is_file():
                fail(f"{family} part is not a regular file: {image_path}")
            size = stat.st_size
            if size <= 0:
                fail(f"{family} part is empty: {image_path}")

            # A write erases every 4 KB sector touched by the part, so compare the rounded erase
            # interval rather than only the nominal byte interval.
            erase_start = offset & ~(FLASH_SECTOR_SIZE - 1)
            erase_end = (offset + size + FLASH_SECTOR_SIZE - 1) & ~(FLASH_SECTOR_SIZE - 1)
            if erase_start < nvs_end and erase_end > nvs_start:
                fail(
                    f"{family} part {relative_path!r} erases "
                    f"0x{erase_start:x}-0x{erase_end - 1:x}, overlapping "
                    f"nvs@0x{nvs_start:x}-0x{nvs_end - 1:x}"
                )
            checked += 1

    print(
        f"web installer plan: {checked} parts checked; "
        f"nvs@0x{nvs_start:x}-0x{nvs_end - 1:x} is untouched"
    )


if __name__ == "__main__":
    main()
