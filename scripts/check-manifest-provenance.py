#!/usr/bin/env python3
"""Validate that a published manifest identifies its exact signed build inputs."""

from __future__ import annotations

import hashlib
import json
import re
import sys
import tempfile
from pathlib import Path


SHA256_RE = re.compile(r"^[0-9a-f]{64}$")
GIT_SHA_RE = re.compile(r"^[0-9a-f]{40}$")
IDF_RE = re.compile(r"^v[0-9]+\.[0-9]+(?:\.[0-9]+)?$")


def digest(path: Path) -> str:
    hasher = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            hasher.update(block)
    return hasher.hexdigest()


def fail(message: str) -> None:
    raise SystemExit(f"manifest provenance: {message}")


def check(
    manifest_path: Path,
    app_path: Path,
    source_sha: str,
    idf_version: str,
    lock_path: Path,
) -> None:
    if not GIT_SHA_RE.fullmatch(source_sha):
        fail(f"expected source SHA is not lowercase 40-hex: {source_sha!r}")
    if not IDF_RE.fullmatch(idf_version):
        fail(f"expected IDF version is invalid: {idf_version!r}")
    try:
        document = json.loads(manifest_path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError) as exc:
        fail(f"cannot read {manifest_path}: {exc}")
    if not isinstance(document, dict) or not isinstance(document.get("provenance"), dict):
        fail("manifest has no provenance object")

    provenance = document["provenance"]
    expected = {
        "source_sha": source_sha,
        "idf_version": idf_version,
        "dependencies_lock_sha256": digest(lock_path),
        "app_sha256": digest(app_path),
    }
    for field, value in expected.items():
        actual = provenance.get(field)
        if actual != value:
            fail(f"{field} mismatch: expected {value!r}, got {actual!r}")
        if field.endswith("_sha256") and not SHA256_RE.fullmatch(actual):
            fail(f"{field} is not lowercase SHA-256")
    print(
        "manifest provenance: OK "
        f"(source {source_sha}, IDF {idf_version}, app {expected['app_sha256']})"
    )


def self_test() -> None:
    with tempfile.TemporaryDirectory() as raw:
        root = Path(raw)
        app = root / "app.bin"
        lock = root / "dependencies.lock"
        manifest = root / "manifest.json"
        app.write_bytes(b"signed-app")
        lock.write_bytes(b"locked-components\n")
        source = "a" * 40
        idf = "v6.0.2"

        def write(**overrides: str) -> None:
            provenance = {
                "source_sha": source,
                "idf_version": idf,
                "dependencies_lock_sha256": digest(lock),
                "app_sha256": digest(app),
            }
            provenance.update(overrides)
            manifest.write_text(json.dumps({"provenance": provenance}), encoding="utf-8")

        write()
        check(manifest, app, source, idf, lock)
        cases = {
            "source_sha": "b" * 40,
            "idf_version": "v0.0.0",
            "dependencies_lock_sha256": "0" * 64,
            "app_sha256": "1" * 64,
        }
        for field, wrong in cases.items():
            write(**{field: wrong})
            try:
                check(manifest, app, source, idf, lock)
            except SystemExit:
                continue
            raise AssertionError(f"self-test failed to reject wrong {field}")
    print("manifest provenance self-test: PASS")


def main(argv: list[str]) -> None:
    if argv == ["--self-test"]:
        self_test()
        return
    if len(argv) != 5:
        fail(
            "usage: check-manifest-provenance.py "
            "<manifest> <signed-app> <source-sha> <idf-version> <dependencies.lock>"
        )
    check(Path(argv[0]), Path(argv[1]), argv[2], argv[3], Path(argv[4]))


if __name__ == "__main__":
    main(sys.argv[1:])
