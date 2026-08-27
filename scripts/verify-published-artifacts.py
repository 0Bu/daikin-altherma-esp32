#!/usr/bin/env python3
"""Read a GitHub Pages firmware feed back and compare it with the local handoff."""

from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
import re
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any, Callable


REPO = Path(__file__).resolve().parents[1]
ALLOWED_HOST = "0bu.github.io"
ALLOWED_PATHS = {
    "/daikin-altherma-esp32/",
    "/daikin-altherma-esp32/dev/",
}
MAX_BINARY = 4 * 1024 * 1024
MAX_SITE_FILE = 4 * 1024 * 1024
MAX_SITE_FILES = 100
MAX_SITE_TOTAL = 32 * 1024 * 1024
ARTIFACT_NAME_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]*\.bin$")
SITE_NAME_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]*$")
REQUIRED_SITE_FILES = {
    "index.html", "serial-port-release.mjs", "web-installer.mjs", "heat-pump-icon.png",
    "LICENSE.txt", "THIRD_PARTY_NOTICES.md", "Apache-2.0.txt", "manifest.json",
    "changelog.json", "daikin-altherma-esp32.bin",
}


class ReadbackError(ValueError):
    """The public feed does not match the exact local artifact handoff."""


class NoRedirect(urllib.request.HTTPRedirectHandler):
    """The attested GitHub Pages origin must serve the bytes itself."""

    def redirect_request(self, req, fp, code, msg, headers, newurl):  # type: ignore[no-untyped-def]
        return None


NO_REDIRECT_OPENER = urllib.request.build_opener(NoRedirect)


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def validate_base_url(value: str) -> str:
    parsed = urllib.parse.urlsplit(value)
    if (
        parsed.scheme != "https"
        or parsed.hostname != ALLOWED_HOST
        or parsed.port is not None
        or parsed.username is not None
        or parsed.password is not None
        or parsed.query
        or parsed.fragment
        or parsed.path not in ALLOWED_PATHS
    ):
        raise ReadbackError(
            "base URL must be the exact release or dev path on "
            "https://0bu.github.io/daikin-altherma-esp32/"
        )
    return urllib.parse.urlunsplit(parsed)


def fetch(url: str, limit: int, cache_buster: str) -> bytes:
    separator = "&" if "?" in url else "?"
    request = urllib.request.Request(
        f"{url}{separator}ci_readback={urllib.parse.quote(cache_buster, safe='')}",
        headers={"Cache-Control": "no-cache", "Pragma": "no-cache"},
    )
    with NO_REDIRECT_OPENER.open(request, timeout=15) as response:
        if response.status != 200:
            raise ReadbackError(f"GET {url} returned HTTP {response.status}")
        declared = response.headers.get("Content-Length")
        if declared is not None and int(declared) > limit:
            raise ReadbackError(f"GET {url} declared {declared} bytes, limit is {limit}")
        data = response.read(limit + 1)
    if len(data) > limit:
        raise ReadbackError(f"GET {url} exceeded {limit} bytes")
    return data


def expected_artifacts(
    manifest: bytes, directory: Path,
) -> tuple[dict[str, Any], dict[str, bytes]]:
    try:
        document = json.loads(manifest)
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise ReadbackError(f"manifest is not valid UTF-8 JSON: {exc}") from exc
    if not isinstance(document, dict) or not isinstance(document.get("artifacts"), list):
        raise ReadbackError("manifest has no artifacts index")
    entries = document["artifacts"]
    names: list[str] = []
    payloads: dict[str, bytes] = {}
    for entry in entries:
        if not isinstance(entry, dict) or set(entry) != {"path", "sha256", "size"}:
            raise ReadbackError("manifest artifact entry has an invalid shape")
        name = entry.get("path")
        digest = entry.get("sha256")
        size = entry.get("size")
        if not isinstance(name, str) or not ARTIFACT_NAME_RE.fullmatch(name) or name in names:
            raise ReadbackError(f"manifest artifact path is unsafe or repeated: {name!r}")
        if not isinstance(digest, str) or len(digest) != 64 or any(c not in "0123456789abcdef" for c in digest):
            raise ReadbackError(f"manifest artifact digest is invalid: {name}")
        if isinstance(size, bool) or not isinstance(size, int) or not 0 < size <= MAX_BINARY:
            raise ReadbackError(f"manifest artifact size is invalid: {name}")
        path = directory / name
        if path.is_symlink() or not path.is_file():
            raise ReadbackError(f"expected artifact is missing or unsafe: {path}")
        data = path.read_bytes()
        if len(data) != size or sha256(data) != digest:
            raise ReadbackError(f"local artifact does not match its manifest index: {name}")
        names.append(name)
        payloads[name] = data
    local_names = sorted(
        path.name for path in directory.glob("*.bin") if path.is_file() and not path.is_symlink()
    )
    if sorted(names) != local_names or "daikin-altherma-esp32.bin" not in payloads:
        raise ReadbackError(
            f"manifest artifact set {sorted(names)!r} does not equal local .bin set {local_names!r}"
        )
    return document, payloads


def expected_site(directory: Path) -> tuple[dict[str, Any], dict[str, bytes]]:
    if directory.is_symlink() or not directory.is_dir():
        raise ReadbackError(f"expected site is missing or unsafe: {directory}")
    payloads: dict[str, bytes] = {}
    for path in sorted(directory.iterdir(), key=lambda item: item.name):
        if path.is_symlink() or not path.is_file() or not SITE_NAME_RE.fullmatch(path.name):
            raise ReadbackError(f"site contains an unsafe entry: {path}")
        data = path.read_bytes()
        if not data or len(data) > MAX_SITE_FILE:
            raise ReadbackError(f"site file has an invalid size: {path.name}")
        payloads[path.name] = data
    missing = REQUIRED_SITE_FILES - set(payloads)
    if missing:
        raise ReadbackError(f"site is missing required files: {sorted(missing)!r}")
    document, artifacts = expected_artifacts(payloads["manifest.json"], directory)
    if set(artifacts) != {name for name in payloads if name.endswith(".bin")}:
        raise ReadbackError("manifest artifact index does not cover the exact Pages .bin set")
    return document, payloads


def verify_payloads(
    remote_payloads: dict[str, bytes],
    expected_document: dict[str, Any],
    expected_payloads: dict[str, bytes],
) -> None:
    if set(remote_payloads) != set(expected_payloads):
        raise ReadbackError("published site file set does not match the local slice")
    remote_manifest = remote_payloads["manifest.json"]
    expected_manifest = expected_payloads["manifest.json"]
    try:
        remote_document = json.loads(remote_manifest)
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise ReadbackError(f"manifest is not valid UTF-8 JSON: {exc}") from exc
    if remote_document != expected_document or remote_manifest != expected_manifest:
        raise ReadbackError(
            f"manifest mismatch: expected {sha256(expected_manifest)}, got {sha256(remote_manifest)}"
        )
    for name, expected in expected_payloads.items():
        remote = remote_payloads[name]
        if remote != expected:
            raise ReadbackError(
                f"{name} mismatch: expected {sha256(expected)}, got {sha256(remote)}"
            )
    provenance = remote_document.get("provenance")
    remote_app = remote_payloads["daikin-altherma-esp32.bin"]
    if not isinstance(provenance, dict) or provenance.get("app_sha256") != sha256(remote_app):
        raise ReadbackError("published manifest app_sha256 does not identify the published app")


def git_bytes(repository: Path, *arguments: str) -> bytes:
    result = subprocess.run(
        ["git", "-C", str(repository), *arguments],
        check=False,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )
    if result.returncode != 0:
        detail = result.stderr.decode("utf-8", errors="replace").strip()
        raise ReadbackError(f"git {' '.join(arguments)} failed: {detail or result.returncode}")
    return result.stdout


def pages_tree_slice(repository: Path, commit: str, prefix: str) -> dict[str, bytes]:
    """Read the exact root/dev file set from one authoritative gh-pages commit."""
    if not re.fullmatch(r"[0-9a-f]{40}", commit):
        raise ReadbackError("published Pages commit must be one full lowercase SHA-1")
    if prefix not in ("", "dev/"):
        raise ReadbackError("Pages slice prefix must be root or dev/")
    raw = git_bytes(repository, "ls-tree", "-r", "-z", commit)
    payloads: dict[str, bytes] = {}
    total_size = 0
    for record in raw.split(b"\0"):
        if not record:
            continue
        metadata, separator, raw_path = record.partition(b"\t")
        fields = metadata.split(b" ")
        if not separator or len(fields) != 3:
            raise ReadbackError("gh-pages tree contains an unparsable entry")
        try:
            path = raw_path.decode("utf-8")
            mode, kind, object_id = (field.decode("ascii") for field in fields)
        except UnicodeDecodeError as exc:
            raise ReadbackError("gh-pages tree contains a non-UTF-8 entry") from exc
        owned = path.startswith("dev/") if prefix else not path.startswith("dev/")
        if not owned:
            continue
        name = path[len(prefix):]
        if mode != "100644" or kind != "blob" or not SITE_NAME_RE.fullmatch(name):
            raise ReadbackError(f"gh-pages {prefix or 'root'} slice has unsafe entry {path!r}")
        if name in payloads or not re.fullmatch(r"[0-9a-f]{40}", object_id):
            raise ReadbackError(f"gh-pages slice has a repeated or invalid entry {path!r}")
        if len(payloads) >= MAX_SITE_FILES:
            raise ReadbackError(f"gh-pages {prefix or 'root'} slice exceeds its file-count limit")
        raw_size = git_bytes(repository, "cat-file", "-s", object_id).decode("ascii").strip()
        if not raw_size.isdigit():
            raise ReadbackError(f"gh-pages blob size is invalid for {path!r}")
        size = int(raw_size)
        limit = MAX_BINARY if name.endswith(".bin") else MAX_SITE_FILE
        if not 0 < size <= limit or total_size + size > MAX_SITE_TOTAL:
            raise ReadbackError(f"gh-pages blob size exceeds the slice budget for {path!r}")
        payload = git_bytes(repository, "cat-file", "blob", object_id)
        if len(payload) != size:
            raise ReadbackError(f"gh-pages blob length changed while reading {path!r}")
        payloads[name] = payload
        total_size += size
    return payloads


def verify_pages_tree(
    repository: Path,
    published_commit: str,
    branch_ref: str,
    prefix: str,
    expected_document: dict[str, Any],
    expected_payloads: dict[str, bytes],
) -> str:
    if branch_ref != "refs/remotes/origin/gh-pages":
        raise ReadbackError("Pages branch ref must be refs/remotes/origin/gh-pages")
    branch_commit = git_bytes(repository, "rev-parse", f"{branch_ref}^{{commit}}").decode().strip()
    if not re.fullmatch(r"[0-9a-f]{40}", branch_commit):
        raise ReadbackError("current gh-pages ref did not resolve to a full commit")
    git_bytes(repository, "merge-base", "--is-ancestor", published_commit, branch_commit)
    verify_payloads(
        pages_tree_slice(repository, published_commit, prefix),
        expected_document,
        expected_payloads,
    )
    verify_payloads(
        pages_tree_slice(repository, branch_commit, prefix),
        expected_document,
        expected_payloads,
    )
    return branch_commit


def load_signing_checker() -> Callable[[bytes, str], list[str]]:
    path = REPO / "scripts/check-signing-key-continuity.py"
    spec = importlib.util.spec_from_file_location("signing_key_continuity", path)
    if spec is None or spec.loader is None:
        raise ReadbackError(f"cannot load signing checker {path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module.check_image


def verify_once(
    base_url: str,
    site_directory: Path,
    cache_buster: str,
) -> tuple[str, dict[str, str]]:
    expected_document, expected_payloads = expected_site(site_directory)
    remote_payloads = {
        name: fetch(urllib.parse.urljoin(base_url, name), len(expected), cache_buster)
        for name, expected in expected_payloads.items()
    }
    verify_payloads(
        remote_payloads, expected_document, expected_payloads,
    )
    remote_app = remote_payloads["daikin-altherma-esp32.bin"]
    pinned = (REPO / "tools/release/ota_signing_key_digest.txt").read_text(encoding="ascii").strip()
    load_signing_checker()(remote_app, pinned)
    return sha256(remote_payloads["manifest.json"]), {
        name: sha256(data) for name, data in sorted(remote_payloads.items())
    }


def self_test() -> None:
    artifacts = {
        "daikin-altherma-esp32.bin": b"app",
        "daikin-altherma-esp32-web-bootloader.bin": b"boot",
    }
    document = {
        "version": "1.2.3",
        "provenance": {"app_sha256": sha256(artifacts["daikin-altherma-esp32.bin"])},
        "artifacts": [
            {"path": name, "sha256": sha256(data), "size": len(data)}
            for name, data in sorted(artifacts.items())
        ],
    }
    manifest = json.dumps(document, sort_keys=True).encode()
    payloads = {
        **artifacts,
        "manifest.json": manifest,
        "index.html": b"index",
        "changelog.json": b"{}",
    }
    verify_payloads(payloads, document, payloads)
    cases = [
        ({**payloads, "manifest.json": manifest + b"\n"}, "manifest"),
        ({**payloads, "daikin-altherma-esp32.bin": b"other"}, "app"),
        ({name: data for name, data in payloads.items() if name != "index.html"}, "site set"),
        ({**payloads, "manifest.json": b"{}"}, "manifest"),
    ]
    for remote_payloads, name in cases:
        try:
            verify_payloads(remote_payloads, document, payloads)
        except ReadbackError:
            continue
        raise AssertionError(f"self-test failed to reject changed {name}")
    assert validate_base_url("https://0bu.github.io/daikin-altherma-esp32/dev/")
    for bad in (
        "http://0bu.github.io/daikin-altherma-esp32/",
        "https://example.test/daikin-altherma-esp32/",
        "https://0bu.github.io/other/",
    ):
        try:
            validate_base_url(bad)
        except ReadbackError:
            continue
        raise AssertionError(f"self-test accepted unsafe URL {bad}")
    assert NoRedirect().redirect_request(None, None, 302, "Found", {}, "https://example.test/") \
        is None

    class RedirectResponse:
        status = 302
        headers = {"Content-Length": "3"}

        def __enter__(self):
            return self

        def __exit__(self, *_args: Any) -> None:
            return None

        def read(self, _limit: int) -> bytes:
            return b"app"

    original_open = NO_REDIRECT_OPENER.open
    NO_REDIRECT_OPENER.open = lambda *_args, **_kwargs: RedirectResponse()  # type: ignore[method-assign]
    try:
        try:
            fetch("https://0bu.github.io/daikin-altherma-esp32/app.bin", 3, "redirect")
        except ReadbackError:
            pass
        else:
            raise AssertionError("self-test accepted a redirect with byte-identical content")
    finally:
        NO_REDIRECT_OPENER.open = original_open  # type: ignore[method-assign]

    with tempfile.TemporaryDirectory(prefix="daikin-pages-readback-") as temporary:
        repository = Path(temporary)
        git_bytes(repository, "init", "--quiet")
        git_bytes(repository, "config", "user.name", "Pages readback self-test")
        git_bytes(repository, "config", "user.email", "pages-readback@example.invalid")
        git_bytes(repository, "config", "commit.gpgsign", "false")
        for name, data in payloads.items():
            (repository / name).write_bytes(data)
        git_bytes(repository, "add", ".")
        git_bytes(repository, "commit", "--quiet", "-m", "exact site")
        exact_commit = git_bytes(repository, "rev-parse", "HEAD").decode().strip()
        git_bytes(repository, "update-ref", "refs/remotes/origin/gh-pages", exact_commit)
        assert verify_pages_tree(
            repository,
            exact_commit,
            "refs/remotes/origin/gh-pages",
            "",
            document,
            payloads,
        ) == exact_commit
        (repository / "stale.bin").write_bytes(b"stale")
        git_bytes(repository, "add", "stale.bin")
        git_bytes(repository, "commit", "--quiet", "-m", "stale public file")
        stale_commit = git_bytes(repository, "rev-parse", "HEAD").decode().strip()
        git_bytes(repository, "update-ref", "refs/remotes/origin/gh-pages", stale_commit)
        try:
            verify_pages_tree(
                repository,
                exact_commit,
                "refs/remotes/origin/gh-pages",
                "",
                document,
                payloads,
            )
        except ReadbackError:
            pass
        else:
            raise AssertionError("self-test accepted an extra file in the current Pages slice")
    print("published artifact readback self-test: PASS")


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base-url")
    parser.add_argument("--expected-site", type=Path)
    parser.add_argument("--pages-commit")
    parser.add_argument("--pages-prefix", choices=("root", "dev"))
    parser.add_argument("--pages-ref", default="refs/remotes/origin/gh-pages")
    parser.add_argument("--cache-buster", default="manual")
    parser.add_argument("--attempts", type=int, default=20)
    parser.add_argument("--delay-seconds", type=float, default=5.0)
    parser.add_argument("--self-test", action="store_true")
    args = parser.parse_args(argv)
    if args.self_test:
        self_test()
        return 0
    if not args.base_url or args.expected_site is None or not args.pages_commit or \
       not args.pages_prefix:
        parser.error(
            "--base-url, --expected-site, --pages-commit and --pages-prefix are required"
        )
    if not 1 <= args.attempts <= 30 or not 0 <= args.delay_seconds <= 10:
        parser.error("attempts must be 1..30 and delay-seconds must be 0..10")
    base_url = validate_base_url(args.base_url)
    expected_document, expected_payloads = expected_site(args.expected_site)
    branch_commit = verify_pages_tree(
        REPO,
        args.pages_commit,
        args.pages_ref,
        "dev/" if args.pages_prefix == "dev" else "",
        expected_document,
        expected_payloads,
    )
    last_error: Exception | None = None
    for attempt in range(1, args.attempts + 1):
        try:
            manifest_hash, artifact_hashes = verify_once(
                base_url,
                args.expected_site,
                f"{args.cache_buster}-{attempt}",
            )
            print(
                f"published artifact readback: OK ({base_url}, manifest {manifest_hash}, "
                f"{len(artifact_hashes)} exact site files, gh-pages {branch_commit}, "
                f"attempt {attempt}/{args.attempts})"
            )
            return 0
        except (OSError, UnicodeError, ValueError, urllib.error.URLError) as exc:
            last_error = exc
            if attempt < args.attempts:
                print(
                    f"published artifact readback: attempt {attempt}/{args.attempts} "
                    f"not current yet: {exc}",
                    file=sys.stderr,
                )
                time.sleep(args.delay_seconds)
    raise ReadbackError(f"public feed did not converge after {args.attempts} attempts: {last_error}")


if __name__ == "__main__":
    try:
        raise SystemExit(main(sys.argv[1:]))
    except ReadbackError as exc:
        raise SystemExit(f"published artifact readback: {exc}") from exc
