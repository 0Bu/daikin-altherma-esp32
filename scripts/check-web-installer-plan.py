#!/usr/bin/env python3
"""Bind the complete official Web Serial plan to the manifest's verified artifacts."""

from __future__ import annotations

import csv
import hashlib
import json
import re
import sys
from pathlib import Path


FLASH_SECTOR_SIZE = 0x1000
MAX_BINARY_BYTES = 0x800000
ARTIFACT_NAME_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]*\.bin$")
SHA256_RE = re.compile(r"^[0-9a-f]{64}$")
APP_NAME = "daikin-altherma-esp32.bin"


def fail(message: str) -> None:
    raise SystemExit(f"web installer plan: {message}")


def unique_object(pairs: list[tuple[str, object]]) -> dict[str, object]:
    result: dict[str, object] = {}
    for key, value in pairs:
        if key in result:
            fail(f"duplicate metadata key: {key!r}")
        result[key] = value
    return result


def read_document(path: Path) -> tuple[bytes, dict[str, object]]:
    try:
        raw = path.read_bytes()
        document = json.loads(raw, object_pairs_hook=unique_object)
    except (OSError, UnicodeError, json.JSONDecodeError, RecursionError) as exc:
        fail(f"cannot read {path}: {exc}")
    if not isinstance(document, dict):
        fail(f"{path} must contain a JSON object")
    return raw, document


def partition_geometries(path: Path) -> dict[str, tuple[int, int]]:
    result: dict[str, tuple[int, int]] = {}
    try:
        with path.open(newline="", encoding="utf-8") as handle:
            for row in csv.reader(line for line in handle if not line.lstrip().startswith("#")):
                if not row or not row[0].strip():
                    continue
                name = row[0].strip()
                try:
                    offset, size = int(row[3].strip(), 0), int(row[4].strip(), 0)
                except (IndexError, ValueError) as exc:
                    fail(f"invalid {name!r} row in {path}: {exc}")
                if name in result or offset < 0 or size <= 0 or \
                   offset % FLASH_SECTOR_SIZE or size % FLASH_SECTOR_SIZE:
                    fail(f"invalid or duplicate {name!r} geometry in {path}")
                result[name] = offset, size
    except (OSError, UnicodeError, csv.Error) as exc:
        fail(f"cannot read {path}: {exc}")
    for name in ("nvs", "otadata", "ota_0", "coredump", "history"):
        if name not in result:
            fail(f"partition {name!r} not found in {path}")
    intervals = sorted((offset, offset + size, name) for name, (offset, size) in result.items())
    for previous, current in zip(intervals, intervals[1:]):
        if previous[1] > current[0]:
            fail(f"partitions {previous[2]!r} and {current[2]!r} overlap")
    return result


def indexed_artifacts(manifest_path: Path, raw_manifest: bytes) -> dict[str, dict[str, object]]:
    _, index = read_document(manifest_path.parent / "artifacts.json")
    if set(index) != {"schema_version", "manifest_sha256", "artifacts"} or \
       type(index.get("schema_version")) is not int or index["schema_version"] != 1 or \
       index.get("manifest_sha256") != hashlib.sha256(raw_manifest).hexdigest() or \
       not isinstance(index.get("artifacts"), list) or not index["artifacts"]:
        fail("artifacts.json does not bind this exact manifest")
    entries: dict[str, dict[str, object]] = {}
    for entry in index["artifacts"]:
        if not isinstance(entry, dict) or set(entry) != {"path", "size", "sha256"}:
            fail("artifact index entry has an invalid shape")
        name, size, digest = entry["path"], entry["size"], entry["sha256"]
        if not isinstance(name, str) or not ARTIFACT_NAME_RE.fullmatch(name) or name in entries:
            fail(f"artifact index path is unsafe or duplicate: {name!r}")
        if type(size) is not int or not 0 < size <= MAX_BINARY_BYTES or \
           not isinstance(digest, str) or not SHA256_RE.fullmatch(digest):
            fail(f"artifact index has invalid size or SHA-256: {name!r}")
        entries[name] = entry
    return entries


def main() -> None:
    if len(sys.argv) != 3:
        fail(f"usage: {Path(sys.argv[0]).name} MANIFEST PARTITIONS_CSV")

    manifest_path = Path(sys.argv[1])
    raw_manifest, manifest = read_document(manifest_path)
    if manifest.get("name") != "daikin-altherma-esp32" or "artifacts" in manifest:
        fail("manifest must name daikin-altherma-esp32 and use sibling artifacts.json")
    if manifest.get("new_install_prompt_erase") is not True:
        fail("new_install_prompt_erase must be true so the user can decline a whole-chip erase")
    builds = manifest.get("builds")
    if not isinstance(builds, list) or not builds:
        fail(f"{manifest_path} has no builds")
    provenance = manifest.get("provenance")
    app_sha256 = provenance.get("app_sha256") if isinstance(provenance, dict) else None
    if not isinstance(app_sha256, str) or not SHA256_RE.fullmatch(app_sha256):
        fail("manifest has no valid application SHA-256 provenance")

    geometry = partition_geometries(Path(sys.argv[2]))
    nvs_start, nvs_size = geometry["nvs"]
    otadata_start, otadata_size = geometry["otadata"]
    app_start, app_size = geometry["ota_0"]
    if nvs_start != 0x9000 or otadata_start != 0xf000 or app_start != 0x20000:
        fail("official flash plan requires nvs@0x9000, otadata@0xf000 and ota_0@0x20000")
    expected_parts = {
        "daikin-altherma-esp32-web-bootloader.bin": (0, 0x8000),
        "daikin-altherma-esp32-web-partition-table.bin": (0x8000, nvs_start),
        "daikin-altherma-esp32-web-ota_data_initial.bin": (otadata_start, otadata_start + otadata_size),
        APP_NAME: (app_start, app_start + app_size),
    }
    preserved = {
        name: (geometry[name][0], sum(geometry[name])) for name in ("nvs", "coredump", "history")
    }
    entries = indexed_artifacts(manifest_path, raw_manifest)
    checked = 0
    targets: set[tuple[str, object]] = set()

    for build in builds:
        if not isinstance(build, dict) or build.get("chipFamily") != "ESP32-S3" or \
           ("serialType" in build and build["serialType"] not in ("cdc", "uart")):
            fail("official installer supports only ESP32-S3 with a valid serial type")
        target = (build["chipFamily"], build.get("serialType"))
        if target in targets:
            fail("manifest repeats a build target")
        targets.add(target)
        parts = build.get("parts")
        if not isinstance(parts, list) or len(parts) != len(expected_parts):
            fail("ESP32-S3 requires the complete four-part canonical flash plan")
        seen: set[str] = set()
        erase_ranges: list[tuple[int, int]] = []

        for part in parts:
            if not isinstance(part, dict) or not isinstance(part.get("path"), str) or \
               type(part.get("offset")) is not int or part["offset"] < 0:
                fail(f"ESP32-S3 has an invalid part entry: {part!r}")
            name, offset = part["path"], part["offset"]
            if name not in expected_parts or name in seen:
                fail(f"flash part is noncanonical or duplicate: {name!r}")
            seen.add(name)
            expected_offset, allowed_end = expected_parts[name]
            if offset != expected_offset:
                fail(f"{name!r} must use canonical offset 0x{expected_offset:x}")
            if name not in entries:
                fail(f"flash part is missing from artifact index: {name!r}")
            entry = entries[name]
            image_path = manifest_path.parent / name
            if image_path.is_symlink():
                fail(f"part is not a regular file: {image_path}")
            try:
                if not image_path.is_file():
                    fail(f"part is missing or not a regular file: {image_path}")
                data = image_path.read_bytes()
            except OSError as exc:
                fail(f"part cannot be read: {image_path}: {exc}")
            size = len(data)
            if size != entry["size"] or hashlib.sha256(data).hexdigest() != entry["sha256"]:
                fail(f"part does not match artifact index size or SHA-256: {name!r}")
            if name == APP_NAME and entry["sha256"] != app_sha256:
                fail("canonical application does not match verified application provenance")

            # writeFlash erases complete sectors, including bytes outside the nominal write.
            erase_start = offset & ~(FLASH_SECTOR_SIZE - 1)
            erase_end = (offset + size + FLASH_SECTOR_SIZE - 1) & ~(FLASH_SECTOR_SIZE - 1)
            for preserved_name, (start, end) in preserved.items():
                if erase_start < end and erase_end > start:
                    fail(
                        f"{name!r} erases 0x{erase_start:x}-0x{erase_end - 1:x}, "
                        f"overlapping {preserved_name}@0x{start:x}-0x{end - 1:x}"
                    )
            if any(erase_start < end and erase_end > start for start, end in erase_ranges):
                fail(f"{name!r} has an overlapping erase-sector interval")
            if erase_end > allowed_end:
                fail(f"{name!r} exceeds its canonical flash interval ending at 0x{allowed_end:x}")
            erase_ranges.append((erase_start, erase_end))
            checked += 1

    print(
        f"web installer plan: {checked} indexed canonical ESP32-S3 parts checked; "
        f"nvs@0x{nvs_start:x}-0x{nvs_start + nvs_size - 1:x} is untouched; "
        "coredump and history are untouched"
    )


if __name__ == "__main__":
    main()
