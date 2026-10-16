"""Compile the pinned build-only encoder in a private cache; never fetch dependencies."""

import hashlib
import json
import os
from pathlib import Path
import platform
import shutil
import stat
import subprocess
import tempfile
import zlib


ROOT = Path(__file__).resolve().parent
VENDOR = ROOT / "vendor" / "zopfli"
ADAPTER = ROOT / "zopfli_gzip.c"
FLAGS = ("-O2", "-std=c99")


def _private_cache(path: Path) -> Path:
    path = path.absolute()
    owners = {0, os.getuid()}
    for parent in reversed(path.parents):
        try:
            info = parent.lstat()
        except FileNotFoundError:
            parent.mkdir(mode=0o700, exist_ok=True)
            info = parent.lstat()
        if info.st_uid not in owners:
            raise RuntimeError("Zopfli cache ancestor has an untrusted owner")
        # System aliases such as /var are safe only when both link and target are trusted.
        if stat.S_ISLNK(info.st_mode):
            info = parent.stat()
        if not stat.S_ISDIR(info.st_mode) or info.st_uid not in owners or (
                info.st_mode & 0o022 and not info.st_mode & stat.S_ISVTX):
            raise RuntimeError("Zopfli cache ancestor must not allow unprotected shared writes")
    path.mkdir(mode=0o700, exist_ok=True)
    info = path.lstat()
    if not stat.S_ISDIR(info.st_mode) or info.st_uid != os.getuid() or info.st_mode & 0o077:
        raise RuntimeError("Zopfli cache must be a private directory owned by the current user")
    canonical = path.resolve(strict=True)
    # An ancestor alias can hide writable directories above its otherwise protected target.
    for parent in canonical.parents:
        info = parent.stat()
        if not stat.S_ISDIR(info.st_mode) or info.st_uid not in owners or (
                info.st_mode & 0o022 and not info.st_mode & stat.S_ISVTX):
            raise RuntimeError("Zopfli cache ancestor must not allow unprotected shared writes")
    return canonical


def _native_helper() -> Path:
    manifest = json.loads((VENDOR / "UPSTREAM.json").read_text(encoding="utf-8"))
    for name, expected in manifest["files"].items():
        if hashlib.sha256((VENDOR / name).read_bytes()).hexdigest() != expected:
            raise RuntimeError(f"vendored Zopfli source hash mismatch: {name}")
    sources = sorted(VENDOR / name for name in manifest["files"] if name.endswith(".c"))
    compiler = shutil.which(os.environ.get("HOST_CC", "cc"))
    if not compiler:
        raise RuntimeError("Zopfli needs a native C compiler (cc, or HOST_CC)")
    try:
        version = subprocess.check_output([compiler, "--version"], stderr=subprocess.STDOUT)
    except (OSError, subprocess.CalledProcessError) as error:
        raise RuntimeError("could not identify the native C compiler for Zopfli") from error
    identity = {
        "upstream": manifest, "flags": FLAGS, "compiler": compiler,
        "compiler_version": version.decode(errors="replace"),
        "platform": platform.system(), "machine": platform.machine(),
        "adapter_sha256": hashlib.sha256(ADAPTER.read_bytes()).hexdigest(),
        "python_adapter_sha256": hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
    }
    key = hashlib.sha256(json.dumps(identity, sort_keys=True).encode()).hexdigest()
    default_cache = Path(tempfile.gettempdir()) / f"daikin-altherma-esp32-zopfli-{os.getuid()}"
    cache = _private_cache(Path(os.environ.get("WEB_ASSET_CACHE_DIR", default_cache)))
    helper = cache / key
    try:
        info = helper.lstat()
    except FileNotFoundError:
        info = None
    if info is not None:
        if not stat.S_ISREG(info.st_mode) or info.st_uid != os.getuid() or (
                info.st_mode & 0o022 or not info.st_mode & stat.S_IXUSR):
            raise RuntimeError("Zopfli cached helper must be a regular, executable, owned file "
                               "without group/world write access")
        return helper
    with tempfile.TemporaryDirectory(prefix="build-", dir=cache) as temporary:
        executable = Path(temporary) / "encoder"
        command = [compiler, *FLAGS, "-I", str(VENDOR), str(ADAPTER),
                   *map(str, sources), "-lm", "-o", str(executable)]
        try:
            subprocess.run(command, check=True, capture_output=True)
        except (OSError, subprocess.CalledProcessError) as error:
            detail = getattr(error, "stderr", b"") or b""
            raise RuntimeError("native Zopfli compilation failed: " +
                               detail.decode(errors="replace")) from error
        executable.chmod(0o700)
        os.replace(executable, helper)
    return helper


def compress(payload: bytes, iterations: int) -> bytes:
    if iterations != 5:
        raise ValueError("the index encoder requires exactly five Zopfli iterations")
    try:
        result = subprocess.run([str(_native_helper())], input=payload, capture_output=True,
                                check=True).stdout
    except (OSError, subprocess.CalledProcessError) as error:
        raise RuntimeError("native Zopfli encoding failed") from error
    if result[:9] != bytes.fromhex("1f8b08000000000002"):
        raise RuntimeError("Zopfli produced unexpected gzip metadata")
    result = result[:9] + b"\xff" + result[10:]
    decoder = zlib.decompressobj(31)
    decoded = decoder.decompress(result) + decoder.flush()
    if not decoder.eof or decoder.unused_data or decoder.unconsumed_tail or decoded != payload:
        raise RuntimeError("Zopfli gzip did not preserve the complete input")
    return result
