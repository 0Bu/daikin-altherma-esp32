#!/usr/bin/env python3
"""One explicitly authorized local firmware test on the inventory-pinned production board.

The saved channel must already be dev. Default: read-only preflight. --execute streams one signed
application, without a feed, merge or bench prerequisite; no request is retried or redirected.
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
sys.path.insert(0, str(ROOT / "tools/dev_ota"))
import evidence

_spec = importlib.util.spec_from_file_location("daikin_production_ota", ROOT / "scripts/production-ota-gate.py")
if _spec is None or _spec.loader is None:
    raise RuntimeError("local OTA support unavailable")
gate = importlib.util.module_from_spec(_spec)
sys.modules[_spec.name] = gate
_spec.loader.exec_module(gate)

MAX_IMAGE_BYTES = 0x1F0000
UPLOAD_TIMEOUT_S = 310
OBSERVE_TIMEOUT_S = 180
CHUNK_BYTES = 64 * 1024


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
        with evidence.repro._regular_fd_at(path.parent, evidence.repro._safe_relative(path.name),
                                           "signed public firmware") as (descriptor, _metadata), \
             os.fdopen(os.dup(descriptor), "rb") as source, snapshot.open("wb") as destination:
            length = os.fstat(source.fileno()).st_size
            if not stat.S_ISREG(os.fstat(source.fileno()).st_mode) or \
               length < 8192 or length > MAX_IMAGE_BYTES or length % 4096:
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


def preflight(endpoint, board: dict, version: str, elf: str) -> tuple[dict, dict]:
    status = gate.request_status_deadline(endpoint, timeout=5)
    gate.validate_identity(status, host=board["host"], mac=board["mac"], version=version, elf=elf)
    gate.require_saved_channel(status, "dev")
    if re.fullmatch(r"[0-9a-f]{16}", str(status.get("boot_id", ""))) is None:
        gate.fail("production board has no usable boot identity")
    ota = gate.request_json_deadline(endpoint, "/ota/status", timeout=5)
    if ota.get("channel") != "dev" or ota.get("busy") is not False or \
       ota.get("rollback_pending") is not False or ota.get("image_state") != "valid":
        gate.fail("production writer is busy, not on dev, or still in firmware probation")
    return status, ota


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


def observe_boot(endpoint, board: dict, artifact: dict, old_boot: str) -> dict:
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
                if status.get("mqtt", {}).get("connected") is not True or \
                   status.get("hp", {}).get("connected") is not True or \
                   int(status.get("hp", {}).get("values", 0)) <= 0 or \
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
        binding = evidence.verify_evidence(args.evidence, args.expected_source_sha256, stream)
        if args.execute:
            evidence.require_upload_unused(args.evidence)
        board = gate.load_inventory()[gate.PRODUCTION_ROLE]
        endpoint = gate.resolve_http_endpoint(board["host"])
        before, _ota = preflight(endpoint, board, args.expected_current_version, args.expected_current_elf)
        result = {"mode": "local-production-test", "artifact": artifact, "evidence": binding, "executed": False}
        if not args.execute:
            return result
        # Repeat the identity/channel check against the same resolved address immediately before POST.
        current, _ota = preflight(endpoint, board, args.expected_current_version, args.expected_current_elf)
        if current.get("boot_id") != before.get("boot_id"):
            gate.fail("production board rebooted during upload preparation")
        # Board reads may have taken seconds. Every source, check/review log, build byte and frozen
        # signed prefix must still bind immediately before recording the sole write attempt.
        binding = evidence.verify_evidence(args.evidence, args.expected_source_sha256, stream)
        result["evidence"] = binding
        evidence.claim_upload_attempt(args.evidence, binding, artifact["sha256"])
        journal = gate.GateJournal()
        journal.checkpoint("local_upload_attempted", artifact={**artifact, **binding},
                           production={"role": "production", "executed": True, **board,
                                       "writer_version": args.expected_current_version,
                                       "writer_elf": args.expected_current_elf,
                                       "writer_boot": current["boot_id"]})
        try:
            response = upload_once(endpoint, stream, artifact)
            ota = gate.request_json_deadline(endpoint, "/ota/status", timeout=1)
            if ota.get("generation") != response["generation"]:
                gate.fail("local upload completion belongs to another OTA generation")
            transfer = {}
            gate.record_ota_transfer_evidence(ota, transfer)
            gate.require_ota_transfer_evidence(board["host"], transfer, phase="local upload",
                                               writer_version=args.expected_current_version,
                                               writer_elf=args.expected_current_elf)
            journal.checkpoint("local_upload_validated", generation=response["generation"], transfer=transfer)
            health = observe_boot(endpoint, board, artifact, current["boot_id"])
            journal.checkpoint("local_test_healthy", outcome="pass", health=health)
        except Exception as error:
            journal.checkpoint("local_test_failed", outcome="fail", error=str(error)[:512],
                               error_context={"exception_type": type(error).__name__})
            raise
        result.update(executed=True, generation=response["generation"], health=health)
        return result


def parse_args(argv=None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__, allow_abbrev=False)
    parser.add_argument("--confirm-production-test", required=True, choices=["production"])
    parser.add_argument("--image", required=True, type=Path)
    parser.add_argument("--expected-app-sha256", required=True)
    parser.add_argument("--expected-current-version", required=True)
    parser.add_argument("--expected-current-elf", required=True)
    parser.add_argument("--evidence", required=True, type=Path)
    parser.add_argument("--expected-source-sha256", required=True)
    parser.add_argument("--execute", action="store_true")
    args = parser.parse_args(argv)
    if re.fullmatch(r"[0-9a-f]{64}", args.expected_app_sha256) is None or \
       re.fullmatch(r"[0-9A-Za-z._+-]+", args.expected_current_version) is None or \
       re.fullmatch(r"[0-9a-f]{9}", args.expected_current_elf) is None or not args.image.is_absolute() or \
       re.fullmatch(r"[0-9a-f]{64}", args.expected_source_sha256) is None or not args.evidence.is_absolute():
        parser.error("expected artifact SHA, current version/ELF and absolute image path are required")
    return args


if __name__ == "__main__":
    try:
        print(json.dumps(run(parse_args()), sort_keys=True))
    except (gate.GateError, gate.CompactTransportError, OSError, ValueError, TimeoutError) as error:
        print(f"dev-ota-upload: stopped ({type(error).__name__}); inspect private evidence, do not retry", file=sys.stderr)
        raise SystemExit(1)
