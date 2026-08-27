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
ARTIFACT_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]*\.bin$")
PINNED_SIGNING_DIGEST = (
    Path(__file__).resolve().parents[1] / "tools/release/ota_signing_key_digest.txt"
)


def digest(path: Path) -> str:
    hasher = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            hasher.update(block)
    return hasher.hexdigest()


def pinned_signing_digest() -> str:
    try:
        value = PINNED_SIGNING_DIGEST.read_text(encoding="ascii").strip()
    except OSError as exc:
        fail(f"cannot read pinned signing-key digest: {exc}")
    if not SHA256_RE.fullmatch(value):
        fail(f"pinned signing-key digest is not lowercase SHA-256: {value!r}")
    return value


def artifact_index(directory: Path) -> list[dict[str, object]]:
    entries: list[dict[str, object]] = []
    for path in sorted(directory.glob("*.bin"), key=lambda item: item.name):
        if path.is_symlink() or not path.is_file() or not ARTIFACT_RE.fullmatch(path.name):
            fail(f"unsafe binary artifact: {path}")
        size = path.stat().st_size
        if size <= 0:
            fail(f"empty binary artifact: {path.name}")
        entries.append({"path": path.name, "sha256": digest(path), "size": size})
    if not entries:
        fail(f"no binary artifacts beside manifest in {directory}")
    return entries


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
        "signing_key_sha256": pinned_signing_digest(),
    }
    for field, value in expected.items():
        actual = provenance.get(field)
        if actual != value:
            fail(f"{field} mismatch: expected {value!r}, got {actual!r}")
        if field.endswith("_sha256") and not SHA256_RE.fullmatch(actual):
            fail(f"{field} is not lowercase SHA-256")
    expected_artifacts = artifact_index(manifest_path.parent)
    if document.get("artifacts") != expected_artifacts:
        fail(
            "artifacts index does not exactly bind every sibling .bin file: "
            f"expected {expected_artifacts!r}, got {document.get('artifacts')!r}"
        )
    print(
        "manifest provenance: OK "
        f"(source {source_sha}, IDF {idf_version}, app {expected['app_sha256']}, "
        f"signing key {expected['signing_key_sha256']})"
    )


def self_test() -> None:
    with tempfile.TemporaryDirectory() as raw:
        root = Path(raw)
        app = root / "app.bin"
        lock = root / "dependencies.lock"
        manifest = root / "manifest.json"
        app.write_bytes(b"signed-app")
        (root / "merged.bin").write_bytes(b"merged-image")
        lock.write_bytes(b"locked-components\n")
        source = "a" * 40
        idf = "v6.0.2"

        def write(**overrides: str) -> None:
            provenance = {
                "source_sha": source,
                "idf_version": idf,
                "dependencies_lock_sha256": digest(lock),
                "app_sha256": digest(app),
                "signing_key_sha256": pinned_signing_digest(),
            }
            provenance.update(overrides)
            manifest.write_text(json.dumps({
                "provenance": provenance,
                "artifacts": artifact_index(root),
            }), encoding="utf-8")

        write()
        check(manifest, app, source, idf, lock)
        cases = {
            "source_sha": "b" * 40,
            "idf_version": "v0.0.0",
            "dependencies_lock_sha256": "0" * 64,
            "app_sha256": "1" * 64,
            "signing_key_sha256": "2" * 64,
        }
        for field, wrong in cases.items():
            write(**{field: wrong})
            try:
                check(manifest, app, source, idf, lock)
            except SystemExit:
                continue
            raise AssertionError(f"self-test failed to reject wrong {field}")
        write()
        document = json.loads(manifest.read_text(encoding="utf-8"))
        document["artifacts"][0]["sha256"] = "0" * 64
        manifest.write_text(json.dumps(document), encoding="utf-8")
        try:
            check(manifest, app, source, idf, lock)
        except SystemExit:
            pass
        else:
            raise AssertionError("self-test accepted an artifact-index mismatch")
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
