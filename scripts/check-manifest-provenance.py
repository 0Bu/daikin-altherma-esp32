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
VERSION_RE = re.compile(r"^[0-9]+\.[0-9]+\.[0-9]+(?:-dev\.[0-9]+)?$")
ARTIFACT_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]*\.bin$")
OTA_MANIFEST_LIMIT_RE = re.compile(
    r"constexpr\s+size_t\s+kManifestMax\s*=\s*([0-9]+)\s*;"
)
ROOT = Path(__file__).resolve().parents[1]
OTA_SOURCE = ROOT / "main/ota_update.cpp"
PINNED_SIGNING_DIGEST = (
    ROOT / "tools/release/ota_signing_key_digest.txt"
)
ARTIFACT_INDEX_NAME = "artifacts.json"
# The signed 1.0.2 release used by the ordinary bench full-download exercise has a fixed 1024-byte
# manifest reader. Keep every newly published feed restorable by that release until the supported
# release floor is deliberately advanced together with the production gate.
LEGACY_RESTORE_MANIFEST_MAX_BYTES = 1024


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


def ota_manifest_limit() -> int:
    try:
        source = OTA_SOURCE.read_text(encoding="utf-8")
    except (OSError, UnicodeError) as exc:
        fail(f"cannot read firmware manifest limit: {exc}")
    matches = OTA_MANIFEST_LIMIT_RE.findall(source)
    if len(matches) != 1:
        fail("firmware manifest limit must be one machine-readable kManifestMax constant")
    limit = int(matches[0])
    if limit <= 0:
        fail("firmware manifest limit must be positive")
    return limit


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
        manifest_bytes = manifest_path.read_bytes()
        manifest_text = manifest_bytes.decode("ascii")
        document = json.loads(manifest_text)
    except (OSError, UnicodeError, json.JSONDecodeError) as exc:
        fail(f"cannot read {manifest_path}: {exc}")
    if b"\\" in manifest_bytes:
        fail("manifest uses escapes rejected by the oldest supported restore parser")
    manifest_limit = min(ota_manifest_limit(), LEGACY_RESTORE_MANIFEST_MAX_BYTES)
    if len(manifest_bytes) > manifest_limit:
        fail(
            f"manifest is {len(manifest_bytes)} bytes but the supported restore path accepts at most "
            f"{manifest_limit} bytes"
        )
    if not isinstance(document, dict) or not isinstance(document.get("provenance"), dict):
        fail("manifest has no provenance object")
    if not isinstance(document.get("version"), str) or not VERSION_RE.fullmatch(document["version"]):
        fail("manifest has no supported version")
    if "artifacts" in document:
        fail(f"manifest embeds artifacts; use the sibling {ARTIFACT_INDEX_NAME}")

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
    artifact_index_path = manifest_path.parent / ARTIFACT_INDEX_NAME
    try:
        index_document = json.loads(artifact_index_path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError) as exc:
        fail(f"cannot read {artifact_index_path}: {exc}")
    expected_index = {
        "schema_version": 1,
        "manifest_sha256": digest(manifest_path),
        "artifacts": expected_artifacts,
    }
    if index_document != expected_index:
        fail(
            f"{ARTIFACT_INDEX_NAME} does not bind the exact manifest and every sibling .bin file: "
            f"expected {expected_index!r}, got {index_document!r}"
        )
    print(
        "manifest provenance: OK "
        f"(source {source_sha}, IDF {idf_version}, app {expected['app_sha256']}, "
        f"signing key {expected['signing_key_sha256']}, "
        f"manifest {len(manifest_bytes)}/{manifest_limit} bytes)"
    )


def self_test() -> None:
    with tempfile.TemporaryDirectory() as raw:
        root = Path(raw)
        app = root / "app.bin"
        lock = root / "dependencies.lock"
        manifest = root / "manifest.json"
        artifacts = root / ARTIFACT_INDEX_NAME
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
                "version": "1.2.3-dev.4",
                "provenance": provenance,
            }), encoding="utf-8")
            artifacts.write_text(json.dumps({
                "schema_version": 1,
                "manifest_sha256": digest(manifest),
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
        index_document = json.loads(artifacts.read_text(encoding="utf-8"))
        index_document["artifacts"][0]["sha256"] = "0" * 64
        artifacts.write_text(json.dumps(index_document), encoding="utf-8")
        try:
            check(manifest, app, source, idf, lock)
        except SystemExit:
            pass
        else:
            raise AssertionError("self-test accepted an artifact-index mismatch")
        write()
        manifest.write_text(
            manifest.read_text(encoding="ascii").replace("dev.4", r"dev.\u0034"),
            encoding="ascii",
        )
        artifacts.write_text(json.dumps({
            "schema_version": 1,
            "manifest_sha256": digest(manifest),
            "artifacts": artifact_index(root),
        }), encoding="utf-8")
        try:
            check(manifest, app, source, idf, lock)
        except SystemExit as exc:
            if "uses escapes" not in str(exc):
                raise
        else:
            raise AssertionError("self-test accepted an escaped legacy identity")
        write()
        document = json.loads(manifest.read_text(encoding="utf-8"))
        document["oversized_test_padding"] = "x" * ota_manifest_limit()
        manifest.write_text(json.dumps(document), encoding="utf-8")
        try:
            check(manifest, app, source, idf, lock)
        except SystemExit as exc:
            if "restore path accepts at most" not in str(exc):
                raise
        else:
            raise AssertionError("self-test accepted a manifest above the firmware limit")
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
