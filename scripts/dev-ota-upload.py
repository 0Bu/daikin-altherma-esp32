#!/usr/bin/env python3
"""One explicitly authorized local firmware test on a selected dev-channel board.

Targets an inventory role (bench or production) or any board host/IP on saved channel dev.
Default: read-only preflight. --execute streams one signed application without a feed, merge,
source receipt or review prerequisite; no request is retried or redirected.
Normal artifact promotion continues to use production-ota-gate.py.
"""

from __future__ import annotations

import argparse
from contextlib import contextmanager
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import socket
import stat
import struct
import subprocess
import sys
import tempfile
import time
from typing import BinaryIO
from urllib.error import HTTPError


ROOT = Path(__file__).resolve().parents[1]


def load_script(name: str, filename: str):
    spec = importlib.util.spec_from_file_location(name, ROOT / "scripts" / filename)
    if spec is None or spec.loader is None:
        raise RuntimeError("local OTA support unavailable")
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


gate = load_script("daikin_production_ota", "production-ota-gate.py")

MAX_IMAGE_BYTES = 0x1F0000
UPLOAD_TIMEOUT_S = 310
OBSERVE_TIMEOUT_S = 180
CHUNK_BYTES = 64 * 1024
MAC_RE = re.compile(r"(?:[0-9A-Fa-f]{2}:){5}[0-9A-Fa-f]{2}")
TARGET_RE = re.compile(r"[A-Za-z0-9](?:[A-Za-z0-9.-]{0,251}[A-Za-z0-9])?")
DIR_OPEN_FLAGS = os.O_RDONLY | getattr(os, "O_DIRECTORY", 0) | getattr(os, "O_NOFOLLOW", 0)
FILE_OPEN_FLAGS = os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0)


def open_nosymlink_directory(directory: Path, label: str) -> int:
    normalized = Path(os.path.abspath(directory))
    if not directory.is_absolute() or str(directory) != str(normalized) or \
       os.path.realpath(normalized) != str(normalized):
        gate.fail(f"{label} must be a canonical non-symlink absolute directory")
    try:
        descriptor = os.open(normalized, DIR_OPEN_FLAGS)
    except OSError:
        gate.fail(f"cannot open {label} without following symlinks")
    if not stat.S_ISDIR(os.fstat(descriptor).st_mode):
        os.close(descriptor)
        gate.fail(f"{label} is not a directory")
    return descriptor


@contextmanager
def open_regular_image(path: Path):
    if not path.is_absolute() or not path.name or path.name in {".", ".."} or "/" in path.name:
        gate.fail("an absolute .bin path is required")
    dir_fd = open_nosymlink_directory(path.parent, "signed image directory")
    file_fd = -1
    try:
        try:
            file_fd = os.open(path.name, FILE_OPEN_FLAGS, dir_fd=dir_fd)
        except OSError:
            gate.fail("cannot open signed local image as a non-symlink file")
        info = os.fstat(file_fd)
        if not stat.S_ISREG(info.st_mode):
            gate.fail("signed local image must be a regular file")
        yield file_fd, info
    finally:
        if file_fd >= 0:
            os.close(file_fd)
        os.close(dir_fd)


def image_metadata(stream: BinaryIO, length: int) -> dict:
    stream.seek(0)
    header = stream.read(288)
    if len(header) != 288 or header[0] != 0xE9 or struct.unpack_from("<H", header, 12)[0] != 9 or \
       struct.unpack_from("<I", header, 32)[0] != 0xABCD5432:
        gate.fail("local image is not an ESP32-S3 application")

    def text(offset: int) -> str:
        field = header[offset:offset + 32]
        if b"\0" not in field:
            gate.fail("local image descriptor is not terminated")
        try:
            return field.split(b"\0", 1)[0].decode("ascii")
        except UnicodeDecodeError:
            gate.fail("local image descriptor is not ASCII")

    version = text(48)
    if not re.fullmatch(r"[0-9A-Za-z._+-]+", version) or text(80) != "daikin-altherma-esp32":
        gate.fail("local image has an invalid version or project identity")
    return {"version": version, "elf": header[176:208].hex()[:9], "bytes": length}


def require_signature(path: Path) -> None:
    try:
        subprocess.run([str(ROOT / "scripts/require-signed.sh"), str(path)],
                       check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=30)
    except (subprocess.SubprocessError, OSError):
        gate.fail("local image failed the pinned Secure Boot v2 signature check")


@contextmanager
def image_snapshot(path: Path, expected_sha256: str):
    """Freeze bounded public firmware bytes; upload the same private copy the verifier inspected."""
    if not path.is_absolute() or path.suffix != ".bin" or \
       re.fullmatch(r"[0-9a-f]{64}", expected_sha256) is None:
        gate.fail("an absolute .bin path and lowercase signed-file SHA-256 are required")
    with tempfile.TemporaryDirectory(prefix="daikin-dev-ota-image-") as directory:
        snapshot = Path(directory) / "app.bin"
        with open_regular_image(path) as (descriptor, stat_info), \
             os.fdopen(os.dup(descriptor), "rb") as source, snapshot.open("wb") as destination:
            length = stat_info.st_size
            if length < 8192 or length > MAX_IMAGE_BYTES or length % 4096:
                gate.fail("signed local image does not fit the application slot")
            digest = hashlib.sha256()
            copied = 0
            while chunk := source.read(min(CHUNK_BYTES, length + 1 - copied)):
                copied += len(chunk)
                if copied > length:
                    gate.fail("local image changed while taking its snapshot")
                digest.update(chunk)
                destination.write(chunk)
            if copied != length or digest.hexdigest() != expected_sha256:
                gate.fail("local signed-image SHA-256 does not match the requested artifact")
        snapshot.chmod(0o400)
        require_signature(snapshot)
        with snapshot.open("rb") as stream:
            metadata = image_metadata(stream, length)
            metadata["sha256"] = expected_sha256
            stream.seek(0)
            yield stream, metadata


def valid_target_name(target: str, expected_mac: str | None) -> bool:
    if TARGET_RE.fullmatch(target) is None or ".." in target:
        return False
    lowered = target.lower()
    if lowered in {"localhost", "daikin-altherma-esp32-setup", "daikin-altherma-esp32-setup.local"}:
        return False
    if lowered in {"daikin-altherma-esp32", "daikin-altherma-esp32.local"} and expected_mac is None:
        return False
    return True


def resolve_target(target: str, expected_mac: str | None) -> tuple[dict, str, bool, str | None]:
    normalized_mac = expected_mac.upper() if expected_mac is not None else None
    if not valid_target_name(target, normalized_mac):
        gate.fail("target must be bench, production, or a specific board host/IP (--expected-mac required for shared mDNS)")
    if target in (gate.PRODUCTION_ROLE, gate.BENCH_ROLE):
        inventory = gate.load_inventory()
        board = dict(inventory[target])
        if normalized_mac is not None and normalized_mac != board["mac"]:
            gate.fail("expected MAC does not match the selected inventory role")
        return board, target, target == gate.PRODUCTION_ROLE, inventory[gate.PRODUCTION_ROLE]["mac"]

    production_mac = None
    if gate.INVENTORY_PATH.is_file():
        inventory = gate.load_inventory()
        prod_board = inventory[gate.PRODUCTION_ROLE]
        bench_board = inventory[gate.BENCH_ROLE]
        production_mac = prod_board["mac"]
        if target.lower() == prod_board["host"].lower():
            if normalized_mac is not None and normalized_mac != prod_board["mac"]:
                gate.fail("expected MAC does not match the inventory production board")
            return {"host": target, "mac": prod_board["mac"]}, gate.PRODUCTION_ROLE, True, production_mac
        if target.lower() == bench_board["host"].lower():
            if normalized_mac is not None and normalized_mac != bench_board["mac"]:
                gate.fail("expected MAC does not match the inventory bench board")
            return {"host": target, "mac": bench_board["mac"]}, gate.BENCH_ROLE, False, production_mac
    return {"host": target, "mac": normalized_mac}, "host", False, production_mac


def preflight(endpoint, board: dict, *, production: bool, production_mac: str | None = None) -> dict:
    status = gate.request_status_deadline(endpoint, timeout=5)
    version, elf, boot = (status.get(key) for key in ("version", "app_elf_sha256", "boot_id"))
    live_mac = str(status.get("wifi", {}).get("mac", "")).upper()
    if not isinstance(version, str) or re.fullmatch(r"[0-9A-Za-z._+-]+", version) is None or \
       not isinstance(elf, str) or re.fullmatch(r"[0-9a-f]{9}", elf) is None or \
       not isinstance(boot, str) or re.fullmatch(r"[0-9a-f]{16}", boot) is None or \
       re.fullmatch(r"(?:[0-9A-F]{2}:){5}[0-9A-F]{2}", live_mac) is None:
        gate.fail("selected board has no usable firmware, MAC or boot identity")
    if production_mac is not None and live_mac == production_mac:
        production = True
    if board.get("mac") is None:
        board["mac"] = live_mac
    checked_status = status if production else {**status, "last_crash": None}
    gate.validate_identity(checked_status, host=board["host"], mac=board["mac"], version=version, elf=elf)
    gate.require_saved_channel(status, "dev")
    ota = gate.request_json_deadline(endpoint, "/ota/status", timeout=5)
    state, pending = ota.get("image_state"), ota.get("rollback_pending")
    # A non-production board bootstrapped over USB can lack a rollback record until its first OTA.
    ready = (state == "valid" and pending is False) or (not production and (
        (state == "unarmed" and pending is False) or
        (state == "unknown" and "rollback_pending" in ota and pending is None)))
    if ota.get("channel") != "dev" or ota.get("busy") is not False or not ready:
        gate.fail("selected board is busy, not on dev, or still in firmware probation")
    return status


def claim_upload_attempt(image: Path, artifact: dict) -> None:
    """One attempt per signed file path, even when the transfer outcome is unknown."""
    marker = image.with_suffix(".upload-attempt")
    directory = open_nosymlink_directory(marker.parent, "signed image directory")
    try:
        descriptor = os.open(marker.name, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW,
                             0o600, dir_fd=directory)
        with os.fdopen(descriptor, "w") as stream:
            stream.write(artifact["sha256"] + "\n")
            stream.flush()
            os.fsync(stream.fileno())
        os.fsync(directory)
    except FileExistsError:
        gate.fail("this signed image path already owns a write attempt; do not retry")
    finally:
        os.close(directory)


def upload_once(endpoint, stream: BinaryIO, artifact: dict) -> dict:
    """The sole write: fixed endpoint, exact length, bounded streaming, no redirect/retry client."""
    path = "/ota/upload?sha256=" + artifact["sha256"]
    deadline = time.monotonic() + UPLOAD_TIMEOUT_S
    connection = socket.socket(endpoint.family, endpoint.socktype, endpoint.proto)

    def remaining() -> None:
        seconds = deadline - time.monotonic()
        if seconds <= 0:
            raise TimeoutError("local OTA upload exceeded its absolute deadline")
        connection.settimeout(seconds)

    try:
        remaining()
        connection.connect(endpoint.sockaddr)
        headers = (f"POST {path} HTTP/1.1\r\nHost: {endpoint.host_header}\r\n"
                   "User-Agent: daikin-dev-ota-upload/1\r\nAccept: application/json\r\n"
                   f"Content-Type: application/octet-stream\r\nContent-Length: {artifact['bytes']}\r\n"
                   "Connection: close\r\n\r\n").encode("ascii")
        remaining()
        connection.sendall(headers)
        stream.seek(0)
        sent = 0
        while chunk := stream.read(CHUNK_BYTES):
            remaining()
            connection.sendall(chunk)
            sent += len(chunk)
        if sent != artifact["bytes"]:
            gate.fail("snapshot length changed during upload; do not retry the write")
        response = gate.read_compact_json_response(connection, endpoint.host_header, path, deadline)
        generation = response.get("generation")
        if response.get("ok") is not True or not isinstance(generation, int) or \
           isinstance(generation, bool) or generation <= 0:
            gate.fail("firmware did not confirm completed upload validation; do not retry")
        return response
    finally:
        connection.close()


def observe_boot(endpoint, board: dict, artifact: dict, old_boot: str, *,
                 production: bool, require_mqtt: bool = False, require_hp: bool = False) -> dict:
    """Read-only observation requires a distinct reboot, the exact build and valid rollback state."""
    deadline = time.monotonic() + OBSERVE_TIMEOUT_S
    new_boot = None
    probation_observed = False
    previous_uptime = -1
    while time.monotonic() < deadline:
        try:
            status = gate.request_status_deadline(endpoint, timeout=min(5, deadline - time.monotonic()))
            # Same-version/same-build reinstall is allowed, so build equality alone cannot prove boot.
            if status.get("boot_id") == old_boot:
                time.sleep(1)
                continue
            gate.validate_identity(status, host=board["host"], mac=board["mac"],
                                   version=artifact["version"], elf=artifact["elf"])
            gate.require_saved_channel(status, "dev")
            boot = status.get("boot_id")
            if re.fullmatch(r"[0-9a-f]{16}", str(boot)) is None or (new_boot and new_boot != boot):
                gate.fail("local test boot identity changed or is absent")
            new_boot = boot
            uptime = gate.required_uptime(status, "local test boot")
            if uptime < previous_uptime:
                gate.fail("local test rebooted during probation")
            previous_uptime = uptime
            ota = gate.request_json_deadline(endpoint, "/ota/status", timeout=5)
            if ota.get("image_state") not in ("pending_verify", "valid") or \
               not isinstance(ota.get("rollback_pending"), bool):
                gate.fail("local test lost its rollback health state")
            if ota.get("image_state") == "pending_verify" and ota.get("rollback_pending") is True:
                probation_observed = True
            if ota.get("image_state") == "valid" and ota.get("rollback_pending") is False:
                # A same-build rollback can look identical to the uploaded application. Require
                # the pending-to-valid transition on this one distinct boot, not a late valid read.
                if not probation_observed:
                    gate.fail("local test probation was not observed; do not retry the upload")
                # /status and /ota/status are separate requests. Bind the valid observation on
                # both sides so a rollback between those requests cannot inherit the prior boot.
                status = gate.request_status_deadline(endpoint, timeout=min(5, deadline - time.monotonic()))
                if status.get("boot_id") != new_boot:
                    gate.fail("local test boot changed during probation acceptance")
                gate.validate_identity(status, host=board["host"], mac=board["mac"],
                                       version=artifact["version"], elf=artifact["elf"])
                gate.require_saved_channel(status, "dev")
                accepted_uptime = gate.required_uptime(status, "local test accepted boot")
                if accepted_uptime < uptime:
                    gate.fail("local test uptime regressed during probation acceptance")
                system = status.get("sys", {})
                counters = gate.board_counters(status)
                mqtt = status.get("mqtt", {})
                hp = status.get("hp", {})
                if ((production or require_mqtt) and mqtt.get("connected") is not True) or \
                   ((production or require_hp) and (hp.get("connected") is not True or int(hp.get("values", 0)) <= 0)) or \
                   int(system.get("free_heap", 0)) < gate.MIN_FINAL_FREE_HEAP or \
                   int(system.get("max_alloc", 0)) < gate.MIN_FINAL_LARGEST_BLOCK or \
                   any(counters[key] != 0 for key in ("heap_restarts", "mqtt_skipped", "poll_skipped")):
                    gate.fail("local test became valid without the required runtime health")
                return {"version": artifact["version"], "elf": artifact["elf"],
                        "boot_id": new_boot, "probation_observed": True,
                        "uptime_s": accepted_uptime, "image_state": "valid", "rollback_pending": False}
        except HTTPError as error:
            if error.code != 503:
                raise
        except (gate.CompactTransportError, OSError, TimeoutError):
            pass  # Read-only probes may miss a reboot; the upload itself is never repeated.
        time.sleep(min(1, max(0, deadline - time.monotonic())))
    gate.fail("local firmware did not complete a healthy distinct boot; do not retry the upload")


def run(args: argparse.Namespace) -> dict:
    with image_snapshot(args.image, args.expected_app_sha256) as (stream, artifact):
        board, role, production, production_mac = resolve_target(args.target, getattr(args, "expected_mac", None))
        endpoint = gate.resolve_http_endpoint(board["host"])
        current = preflight(endpoint, board, production=production, production_mac=production_mac)
        if production_mac is not None and board.get("mac") == production_mac:
            production = True
            role = gate.PRODUCTION_ROLE
        result = {"mode": "local-test", "target": role, "artifact": artifact, "executed": False}
        if not args.execute:
            return result
        claim_upload_attempt(args.image, artifact)
        journal = gate.GateJournal()
        writer = "production" if production else "test_board"
        journal_role = gate.PRODUCTION_ROLE if production else gate.BENCH_ROLE
        journal.checkpoint("local_upload_attempted", artifact=artifact,
                           **{writer: {"role": journal_role, "target": role, "executed": True, **board,
                                       "writer_version": current["version"],
                                       "writer_elf": current["app_elf_sha256"],
                                       "writer_boot": current["boot_id"]}})
        require_mqtt = current.get("mqtt", {}).get("connected") is True
        require_hp = current.get("hp", {}).get("connected") is True and int(current.get("hp", {}).get("values", 0)) > 0
        try:
            response = upload_once(endpoint, stream, artifact)
            ota = gate.request_json_deadline(endpoint, "/ota/status", timeout=1)
            if ota.get("generation") != response["generation"]:
                gate.fail("local upload completion belongs to another OTA generation")
            transfer = {}
            gate.record_ota_transfer_evidence(ota, transfer)
            gate.require_ota_transfer_evidence(board["host"], transfer, phase="local upload",
                                               writer_version=current["version"],
                                               writer_elf=current["app_elf_sha256"])
            journal.checkpoint("local_upload_validated", generation=response["generation"], transfer=transfer)
            health = observe_boot(endpoint, board, artifact, current["boot_id"],
                                  production=production, require_mqtt=require_mqtt, require_hp=require_hp)
            journal.checkpoint("local_test_healthy", outcome="pass", health=health)
        except Exception as error:
            journal.checkpoint("local_test_failed", outcome="fail", error=str(error)[:512],
                               error_context={"exception_type": type(error).__name__})
            raise
        result.update(executed=True, generation=response["generation"], health=health)
        return result


def parse_args(argv=None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__, allow_abbrev=False)
    parser.add_argument("--target", required=True, help="bench, production, or board host/IP")
    parser.add_argument("--expected-mac", default=None, help="optional colon-separated MAC identity")
    parser.add_argument("--image", required=True, type=Path)
    parser.add_argument("--expected-app-sha256", required=True)
    parser.add_argument("--execute", action="store_true")
    args = parser.parse_args(argv)
    if args.expected_mac is not None and MAC_RE.fullmatch(args.expected_mac) is None:
        parser.error("--expected-mac must be colon-separated hex (AA:BB:CC:DD:EE:FF)")
    if not valid_target_name(args.target, args.expected_mac):
        parser.error("--target must be bench, production, or a specific board host/IP (--expected-mac required for shared mDNS)")
    if re.fullmatch(r"[0-9a-f]{64}", args.expected_app_sha256) is None or \
       not args.image.is_absolute() or args.image.suffix != ".bin":
        parser.error("signed image must be an absolute .bin path with its lowercase SHA-256")
    return args


if __name__ == "__main__":
    try:
        print(json.dumps(run(parse_args()), sort_keys=True))
    except (gate.GateError, gate.CompactTransportError, OSError, ValueError, TimeoutError) as error:
        print(f"dev-ota-upload: stopped ({type(error).__name__}); inspect private evidence, do not retry", file=sys.stderr)
        raise SystemExit(1)
