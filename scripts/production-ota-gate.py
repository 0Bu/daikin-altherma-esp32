#!/usr/bin/env python3
"""Fail-closed bench -> production OTA promotion gate.

This is the only agent-approved path to POST /ota/update on the production board. It verifies one
exact signed dev artifact, reruns the X10A/OTA host contracts, proves that exact image on the
private-inventory bench role under concurrent HTTP/TLS pressure, then performs at most one POST on
the distinct production role and observes
the canary read-only. It never creates a release and never retries a write.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import socket
import struct
import subprocess
import sys
import tempfile
import threading
import time
from typing import Any
from urllib.parse import urlencode, urljoin, urlparse, urlunparse
from urllib.request import Request, urlopen


ROOT = Path(__file__).resolve().parents[1]
BENCH_ROLE = "bench"
PRODUCTION_ROLE = "production"
INVENTORY_PATH = Path(os.environ.get("XDG_CONFIG_HOME", Path.home() / ".config")) / \
    "daikin-altherma-esp32/production-ota.json"
STRESS_SECONDS = 180
MAX_TEST_START_UPTIME_S = 120
MIN_STATUS_SAMPLES = 300
MIN_VALUES_SAMPLES = 120
MIN_DIAG_SAMPLES = 10
MIN_FINAL_FREE_HEAP = 24 * 1024
MIN_FINAL_LARGEST_BLOCK = 16 * 1024
MAX_X10A_TIMEOUT_DELTA = 3
HTTP_TIMEOUT_S = 5
OTA_TIMEOUT_S = 180
OTA_OFFER_SETTLE_SECONDS = 1.0
OTA_OFFER_POLL_SECONDS = 0.1
DEV_MANIFEST_SUFFIX = "/dev/manifest.json"
OFFICIAL_MANIFEST_URL = "https://0bu.github.io/daikin-altherma-esp32/dev/manifest.json"


class GateError(RuntimeError):
    pass


def fail(message: str) -> None:
    raise GateError(message)


def load_inventory(path: Path = INVENTORY_PATH) -> dict[str, dict[str, str]]:
    try:
        raw = json.loads(path.read_text())
    except (OSError, json.JSONDecodeError) as error:
        fail(f"local board inventory {path} is missing or invalid: {error}")
    if not isinstance(raw, dict) or raw.get("schema_version") != 1:
        fail("local board inventory must be a schema_version 1 object")
    result: dict[str, dict[str, str]] = {}
    for role in (BENCH_ROLE, PRODUCTION_ROLE):
        board = raw.get(role)
        if not isinstance(board, dict):
            fail(f"local board inventory is missing role {role}")
        host = board.get("host")
        mac = board.get("mac")
        if not isinstance(host, str) or not re.fullmatch(r"[A-Za-z0-9.-]+", host):
            fail(f"local board inventory {role}.host is invalid")
        if not isinstance(mac, str) or not re.fullmatch(r"(?:[0-9A-F]{2}:){5}[0-9A-F]{2}", mac):
            fail(f"local board inventory {role}.mac must be uppercase colon-separated hex")
        result[role] = {"host": host, "mac": mac}
    if result[BENCH_ROLE]["host"] == result[PRODUCTION_ROLE]["host"] or \
       result[BENCH_ROLE]["mac"] == result[PRODUCTION_ROLE]["mac"]:
        fail("bench and production inventory identities must be distinct")
    return result


def run_checked(argv: list[str], *, capture: bool = False) -> str:
    result = subprocess.run(
        argv,
        cwd=ROOT,
        check=False,
        text=True,
        capture_output=capture,
    )
    if result.returncode != 0:
        detail = (result.stderr or result.stdout or "").strip() if capture else ""
        fail(f"command failed ({' '.join(argv)}): {detail or f'exit {result.returncode}'}")
    return result.stdout if capture else ""


def request_bytes(url: str, *, method: str = "GET", timeout: int = HTTP_TIMEOUT_S) -> bytes:
    request = Request(url, method=method, headers={"User-Agent": "daikin-production-ota-gate/1"})
    with urlopen(request, timeout=timeout) as response:
        if response.status < 200 or response.status >= 300:
            fail(f"{method} {url} returned HTTP {response.status}")
        return response.read()


def request_json(host: str, path: str, *, timeout: int = HTTP_TIMEOUT_S) -> dict[str, Any]:
    raw = request_bytes(f"http://{host}{path}", timeout=timeout)
    value = json.loads(raw)
    if not isinstance(value, dict):
        fail(f"{host}{path} did not return a JSON object")
    return value


def cache_busted(url: str) -> str:
    parsed = urlparse(url)
    query = urlencode({"gate": str(time.time_ns())})
    return urlunparse(parsed._replace(query=query))


def validate_manifest(
    manifest_url: str,
    manifest: dict[str, Any],
    expected_source_sha: str,
    expected_version: str,
    expected_app_sha256: str,
) -> str:
    parsed = urlparse(manifest_url)
    if manifest_url != OFFICIAL_MANIFEST_URL or parsed.scheme != "https" or not parsed.path.endswith(DEV_MANIFEST_SUFFIX):
        fail("manifest must be the official HTTPS dev channel; release/foreign manifests are forbidden")
    if not re.fullmatch(r"[0-9a-f]{40}", expected_source_sha):
        fail("expected source SHA must be lowercase 40-hex")
    if not re.fullmatch(r"[0-9a-f]{64}", expected_app_sha256):
        fail("expected app SHA-256 must be lowercase 64-hex")
    if manifest.get("version") != expected_version or "-dev." not in expected_version:
        fail("manifest version is not the explicitly expected dev version")
    provenance = manifest.get("provenance")
    if not isinstance(provenance, dict):
        fail("manifest provenance is missing")
    if provenance.get("source_sha") != expected_source_sha:
        fail("manifest source SHA does not match the explicitly expected main commit")
    if provenance.get("app_sha256") != expected_app_sha256:
        fail("manifest app SHA-256 does not match the explicitly expected signed image")
    builds = manifest.get("builds")
    if not isinstance(builds, list):
        fail("manifest builds are missing")
    candidates: list[str] = []
    for build in builds:
        if not isinstance(build, dict) or build.get("chipFamily") != "ESP32-S3":
            continue
        for part in build.get("parts", []):
            if isinstance(part, dict) and part.get("offset") == 0x20000:
                path = part.get("path")
                if isinstance(path, str) and path.endswith(".bin"):
                    candidates.append(path)
    if len(candidates) != 1:
        fail("manifest must name exactly one ESP32-S3 application at offset 0x20000")
    return urljoin(manifest_url, candidates[0])


def verify_local_source(expected_source_sha: str) -> None:
    head = run_checked(["git", "rev-parse", "HEAD"], capture=True).strip()
    if head != expected_source_sha:
        fail(f"working tree HEAD {head} is not manifest source {expected_source_sha}")
    status = run_checked(["git", "status", "--porcelain"], capture=True)
    if status.strip():
        fail("working tree is dirty; host contracts would not describe the published artifact")


def verify_image(binary: bytes, expected_version: str, expected_sha256: str) -> str:
    actual = hashlib.sha256(binary).hexdigest()
    if actual != expected_sha256:
        fail(f"downloaded app SHA-256 {actual} does not match manifest {expected_sha256}")
    with tempfile.TemporaryDirectory(prefix="daikin-production-ota-") as tmp:
        image = Path(tmp) / "app.bin"
        image.write_bytes(binary)
        run_checked([str(ROOT / "scripts/require-signed.sh"), str(image)])
        esptool = shutil.which("esptool") or shutil.which("esptool.py")
        if not esptool:
            fail("esptool is required to bind device status to the signed image ELF")
        info = run_checked([esptool, "image-info", str(image)], capture=True)
    version = re.search(r"^App version:\s*(\S+)", info, re.MULTILINE)
    elf = re.search(r"^ELF file SHA256:\s*([0-9a-f]{64})", info, re.MULTILINE)
    target = re.search(r"^Detected image type:\s*ESP32-S3$", info, re.MULTILINE)
    if not version or version.group(1) != expected_version or not elf or not target:
        fail("signed image metadata does not match expected ESP32-S3 dev build")
    return elf.group(1)[:9]


def validate_identity(status: dict[str, Any], *, host: str, mac: str, version: str, elf: str) -> None:
    wifi = status.get("wifi", {})
    if str(wifi.get("mac", "")).upper() != mac:
        fail(f"{host} MAC does not match the pinned board identity")
    if status.get("version") != version or status.get("app_elf_sha256") != elf:
        fail(f"{host} is not running the exact signed artifact {version}/{elf}")
    if not wifi.get("connected") or wifi.get("rolled_back"):
        fail(f"{host} is disconnected or reports rollback")
    sys_status = status.get("sys", {})
    crash = status.get("last_crash")
    if sys_status.get("safe_mode") or (isinstance(crash, dict) and crash.get("fault")):
        fail(f"{host} reports safe mode or a fault crash")


def board_counters(status: dict[str, Any]) -> dict[str, int]:
    system = status.get("sys", {})
    hp = status.get("hp", {})
    return {
        "heap_restarts": int(system.get("heap_restarts", 0)),
        "mqtt_skipped": int(system.get("mqtt_skipped", 0)),
        "poll_skipped": int(system.get("poll_skipped", 0)),
        "crc_err": int(hp.get("crc_err", 0)),
        "timeout_err": int(hp.get("timeout_err", 0)),
    }


def x10a_timeout_delta_exceeded(
    *, require_x10a: bool, baseline: dict[str, int], final: dict[str, int],
) -> bool:
    return require_x10a and final["timeout_err"] - baseline["timeout_err"] > MAX_X10A_TIMEOUT_DELTA


def stress_board(
    *, host: str, mac: str, version: str, elf: str, require_x10a: bool,
    require_weather: bool,
) -> dict[str, Any]:
    started = request_json(host, "/status")
    validate_identity(started, host=host, mac=mac, version=version, elf=elf)
    if int(started.get("uptime_s", MAX_TEST_START_UPTIME_S + 1)) > MAX_TEST_START_UPTIME_S:
        fail(f"{host} must enter the pressure gate within {MAX_TEST_START_UPTIME_S}s of boot")
    baseline = board_counters(started)
    weather_before = started.get("weather_forecast", {})
    deadline = time.monotonic() + STRESS_SECONDS
    lock = threading.Lock()
    samples: dict[str, int] = {"status": 0, "values": 0, "diag": 0}
    errors: list[str] = []
    uptimes: list[int] = []
    disconnected = 0

    def remember(kind: str, error: BaseException) -> None:
        with lock:
            if len(errors) < 20:
                errors.append(f"{kind}: {error}")

    def status_loop() -> None:
        nonlocal disconnected
        while time.monotonic() < deadline:
            try:
                status = request_json(host, "/status")
                validate_identity(status, host=host, mac=mac, version=version, elf=elf)
                hp = status.get("hp", {})
                mqtt = status.get("mqtt", {})
                if require_x10a and (not hp.get("connected") or int(hp.get("values", 0)) <= 0):
                    disconnected += 1
                if not mqtt.get("connected"):
                    disconnected += 1
                with lock:
                    samples["status"] += 1
                    uptimes.append(int(status.get("uptime_s", -1)))
            except BaseException as error:  # keep the other probes running and report every failure
                remember("status", error)
            time.sleep(0.25)

    def json_loop(path: str, kind: str, interval: float) -> None:
        while time.monotonic() < deadline:
            try:
                raw = request_bytes(f"http://{host}{path}")
                if kind == "values":
                    json.loads(raw)
                elif not raw:
                    fail("empty diagnostic response")
                with lock:
                    samples[kind] += 1
            except BaseException as error:
                remember(kind, error)
            time.sleep(interval)

    workers = [
        threading.Thread(target=status_loop, daemon=True),
        threading.Thread(target=json_loop, args=("/values", "values", 1.0), daemon=True),
        threading.Thread(target=json_loop, args=("/diag", "diag", 15.0), daemon=True),
    ]
    for worker in workers:
        worker.start()
    # A read-only check makes the device open real manifest TLS while all three HTTP probes are
    # already active. A previously cached successful weather value alone would not prove overlap.
    request_json(host, f"/ota/check?ms={int(time.time() * 1000)}")
    for worker in workers:
        worker.join(STRESS_SECONDS + HTTP_TIMEOUT_S + 10)

    finished = request_json(host, "/status")
    validate_identity(finished, host=host, mac=mac, version=version, elf=elf)
    ota_check = request_json(host, "/ota/status")
    if ota_check.get("state") != "idle" or ota_check.get("available") != version:
        fail(f"{host} OTA manifest TLS did not finish cleanly on the exact dev version")
    final = board_counters(finished)
    if errors:
        fail(f"{host} live stress had errors: {'; '.join(errors)}")
    if samples["status"] < MIN_STATUS_SAMPLES or samples["values"] < MIN_VALUES_SAMPLES or samples["diag"] < MIN_DIAG_SAMPLES:
        fail(f"{host} live stress produced too few successful samples: {samples}")
    if not uptimes or any(later < earlier for earlier, later in zip(uptimes, uptimes[1:])):
        fail(f"{host} rebooted during live stress")
    if disconnected:
        fail(f"{host} lost a required MQTT/X10A connection in {disconnected} status samples")
    for key in ("heap_restarts", "mqtt_skipped", "poll_skipped", "crc_err"):
        if final[key] != baseline[key]:
            fail(f"{host} {key} changed during live stress ({baseline[key]} -> {final[key]})")
    if x10a_timeout_delta_exceeded(
        require_x10a=require_x10a, baseline=baseline, final=final,
    ):
        fail(f"{host} X10A timeout delta exceeded {MAX_X10A_TIMEOUT_DELTA}")
    system = finished.get("sys", {})
    if int(system.get("free_heap", 0)) < MIN_FINAL_FREE_HEAP:
        fail(f"{host} final internal free heap is below {MIN_FINAL_FREE_HEAP} bytes")
    if int(system.get("max_alloc", 0)) < MIN_FINAL_LARGEST_BLOCK:
        fail(f"{host} final largest block is below {MIN_FINAL_LARGEST_BLOCK} bytes")
    weather = finished.get("weather_forecast", {})
    if require_weather:
        if not weather.get("configured"):
            fail(f"{host} weather must be configured so the stress covers a real TLS fetch")
        if weather.get("state") != "ok" or int(weather.get("errors", 0)) != 0:
            fail(f"{host} weather TLS did not finish cleanly during the gate")
        if int(weather.get("successes", 0)) <= 0 or not weather.get("fetched_at"):
            fail(f"{host} has no successful weather TLS evidence from this fresh boot")
        if int(weather.get("successes", 0)) < int(weather_before.get("successes", 0)):
            fail(f"{host} weather success counter regressed during live stress")
    return {
        "samples": samples,
        "uptime": [uptimes[0], uptimes[-1]],
        "counters_before": baseline,
        "counters_after": final,
        "free_heap": int(system.get("free_heap", 0)),
        "largest_block": int(system.get("max_alloc", 0)),
        "ota_check": {"state": ota_check.get("state"), "available": ota_check.get("available")},
    }


def mqtt_remaining_length(value: int) -> bytes:
    out = bytearray()
    while True:
        digit = value % 128
        value //= 128
        if value:
            digit |= 0x80
        out.append(digit)
        if not value:
            return bytes(out)


def mqtt_string(value: str) -> bytes:
    encoded = value.encode()
    return struct.pack("!H", len(encoded)) + encoded


def mqtt_packet(header: int, body: bytes) -> bytes:
    return bytes([header]) + mqtt_remaining_length(len(body)) + body


def verify_retained_x10a(status: dict[str, Any]) -> dict[str, int | bool | str]:
    mqtt = status.get("mqtt", {})
    broker = str(mqtt.get("broker", ""))
    if mqtt.get("tls") or mqtt.get("has_creds") or ":" not in broker:
        fail("production retained-state proof supports the configured plaintext credential-free LAN broker only")
    host, port_text = broker.rsplit(":", 1)
    topic = f"{mqtt.get('base')}/x10a"
    client_id = f"ota-gate-{time.time_ns():x}"
    connect = mqtt_packet(0x10, mqtt_string("MQTT") + bytes([4, 2, 0, 30]) + mqtt_string(client_id))
    subscribe = mqtt_packet(0x82, bytes([0, 1]) + mqtt_string(topic) + bytes([0]))

    def recv_exact(conn: socket.socket, size: int) -> bytes:
        data = bytearray()
        while len(data) < size:
            chunk = conn.recv(size - len(data))
            if not chunk:
                fail("MQTT broker closed the evidence connection")
            data.extend(chunk)
        return bytes(data)

    def recv_packet(conn: socket.socket) -> tuple[int, bytes]:
        header = recv_exact(conn, 1)[0]
        remaining = 0
        multiplier = 1
        for _ in range(4):
            digit = recv_exact(conn, 1)[0]
            remaining += (digit & 127) * multiplier
            if not digit & 128:
                return header, recv_exact(conn, remaining)
            multiplier *= 128
        fail("MQTT evidence packet has an invalid remaining-length field")

    with socket.create_connection((host, int(port_text)), timeout=HTTP_TIMEOUT_S) as conn:
        conn.settimeout(HTTP_TIMEOUT_S)
        conn.sendall(connect)
        if recv_packet(conn) != (0x20, bytes([0x00, 0x00])):
            fail("MQTT broker refused the production evidence client")
        conn.sendall(subscribe)
        deadline = time.monotonic() + HTTP_TIMEOUT_S
        while time.monotonic() < deadline:
            header, body = recv_packet(conn)
            if header >> 4 != 3:
                continue  # SUBACK or keepalive traffic before the retained PUBLISH
            if len(body) < 2:
                fail("retained X10A MQTT packet is truncated")
            topic_len = struct.unpack("!H", body[:2])[0]
            payload_offset = 2 + topic_len
            qos = (header >> 1) & 0x03
            if qos:
                payload_offset += 2
            if payload_offset > len(body):
                fail("retained X10A MQTT topic or packet id is truncated")
            got_topic = body[2:2 + topic_len].decode()
            payload = body[payload_offset:]
            parsed = json.loads(payload)
            groups = len(parsed)
            rows = sum(len(value) for value in parsed.values() if isinstance(value, dict))
            if got_topic != topic or not header & 1 or not groups or not rows or len(payload) > 12 * 1024:
                fail("retained X10A payload is absent, unretained, empty, oversized, or on the wrong topic")
            return {"topic": topic, "retained": True, "bytes": len(payload), "groups": groups, "rows": rows}
    fail("timed out waiting for retained production X10A state")


def run_local_gates() -> None:
    run_checked([str(ROOT / "scripts/run-mock-tests.sh"), "--coverage"])
    run_checked([str(ROOT / "scripts/run-contract-tests.sh")])


def ota_offer_settled(
    status: dict[str, Any], expected_version: str, seen_checking: bool,
    first_seen_at: float | None, now: float,
) -> tuple[bool, bool, float | None]:
    """Require one exact idle offer to remain stable before the sole update POST.

    The caller must first observe this check generation's ``checking`` state.  That prevents a
    previous exact idle offer from arming during the firmware's 1.1-second pre-check quiesce lead.
    The firmware then publishes the final check result immediately before its OTA task releases the
    internal busy claim, so a second exact idle sample after the bounded settle interval closes the
    other side of the hand-off without adding a retrying write path.
    """
    if status.get("state") == "error":
        fail(f"production OTA check failed: {status.get('message', '')}")
    if status.get("state") == "checking":
        return False, True, None
    if not seen_checking:
        return False, False, None
    if status.get("state") != "idle" or not status.get("available"):
        return False, True, None
    if status.get("available") != expected_version or not status.get("update_available"):
        # /ota/check is asynchronous.  Its first status sample may still be the previous completed
        # check, so a stale idle offer neither authorizes the write nor fails a check that has not
        # published its own result yet.  Only the expected offer can start the settle interval.
        return False, True, None
    if first_seen_at is None:
        return False, True, now
    return now - first_seen_at >= OTA_OFFER_SETTLE_SECONDS, True, first_seen_at


def wait_for_ota_offer(host: str, expected_version: str) -> dict[str, Any]:
    request_json(host, f"/ota/check?ms={int(time.time() * 1000)}")
    deadline = time.monotonic() + 30
    seen_checking = False
    first_seen_at: float | None = None
    while time.monotonic() < deadline:
        status = request_json(host, "/ota/status")
        ready, seen_checking, first_seen_at = ota_offer_settled(
            status, expected_version, seen_checking, first_seen_at, time.monotonic(),
        )
        if ready:
            return status
        time.sleep(OTA_OFFER_POLL_SECONDS)
    fail("production OTA check did not settle on the exact gated dev version within 30 seconds")


def post_update_once(host: str) -> None:
    # Deliberately one un-retried write. Every loop after this function is GET-only.
    request_bytes(f"http://{host}/ota/update", method="POST", timeout=HTTP_TIMEOUT_S)


def wait_for_new_firmware(host: str, version: str, elf: str) -> dict[str, Any]:
    deadline = time.monotonic() + OTA_TIMEOUT_S
    saw_done = False
    while time.monotonic() < deadline:
        try:
            ota = request_json(host, "/ota/status")
            if ota.get("state") == "error":
                fail(f"production OTA failed: {ota.get('message', '')}")
            saw_done = saw_done or ota.get("state") == "done"
            status = request_json(host, "/status")
            if status.get("version") == version and status.get("app_elf_sha256") == elf:
                return status
        except (OSError, TimeoutError, json.JSONDecodeError):
            pass  # expected only while the one accepted update reboots; never retried as a write
        time.sleep(1)
    fail(f"production board did not return on {version}/{elf}; OTA done observed={saw_done}")


def self_test() -> None:
    source = "a" * 40
    app = "b" * 64
    fixture = {
        "version": "1.2.3-dev.4",
        "provenance": {"source_sha": source, "app_sha256": app},
        "builds": [{"chipFamily": "ESP32-S3", "parts": [{"path": "app.bin", "offset": 0x20000}]}],
    }
    assert validate_manifest(OFFICIAL_MANIFEST_URL, fixture, source, "1.2.3-dev.4", app) == "https://0bu.github.io/daikin-altherma-esp32/dev/app.bin"
    try:
        validate_manifest("https://example.test/project/manifest.json", fixture, source, "1.2.3-dev.4", app)
    except GateError:
        pass
    else:
        raise AssertionError("release manifest passed the dev-only gate")
    fixture_mac = ":".join(["02", "00", "00", "00", "00", "01"])
    healthy = {
        "version": "x", "app_elf_sha256": "e",
        "wifi": {"mac": fixture_mac, "connected": True, "rolled_back": False},
        "sys": {"safe_mode": False}, "last_crash": None,
    }
    validate_identity(healthy, host="bench.invalid", mac=fixture_mac, version="x", elf="e")
    timeout_before = {"timeout_err": 1}
    timeout_after = {"timeout_err": MAX_X10A_TIMEOUT_DELTA + 2}
    assert not x10a_timeout_delta_exceeded(
        require_x10a=False, baseline=timeout_before, final=timeout_after,
    )
    assert x10a_timeout_delta_exceeded(
        require_x10a=True, baseline=timeout_before, final=timeout_after,
    )
    checking = {"state": "checking", "available": ""}
    offered = {
        "state": "idle", "available": "1.2.3-dev.4", "update_available": True,
    }
    ready, generation, seen = ota_offer_settled(offered, "1.2.3-dev.4", False, None, 9.0)
    assert not ready and not generation and seen is None  # stale exact offer cannot arm
    ready, generation, seen = ota_offer_settled(checking, "1.2.3-dev.4", False, None, 10.0)
    assert not ready and generation and seen is None
    ready, generation, seen = ota_offer_settled(
        offered, "1.2.3-dev.4", generation, None, 20.0,
    )
    assert not ready and generation and seen == 20.0
    ready, generation, seen = ota_offer_settled(
        offered, "1.2.3-dev.4", generation, seen, 20.999,
    )
    assert not ready and generation and seen == 20.0
    ready, generation, seen = ota_offer_settled(
        offered, "1.2.3-dev.4", generation, seen, 21.0,
    )
    assert ready and generation and seen == 20.0
    stale = {"state": "idle", "available": "1.2.3-dev.3", "update_available": True}
    ready, generation, seen = ota_offer_settled(stale, "1.2.3-dev.4", True, None, 22.0)
    assert not ready and generation and seen is None
    with tempfile.TemporaryDirectory(prefix="daikin-production-ota-selftest-") as tmp:
        inventory_path = Path(tmp) / "inventory.json"
        inventory_path.write_text(json.dumps({
            "schema_version": 1,
            "bench": {"host": "bench.invalid", "mac": fixture_mac},
            "production": {
                "host": "production.invalid",
                "mac": ":".join(["02", "00", "00", "00", "00", "02"]),
            },
        }))
        assert load_inventory(inventory_path)[PRODUCTION_ROLE]["host"] == "production.invalid"
    print("production OTA gate self-test passed")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest-url")
    parser.add_argument("--expected-source-sha")
    parser.add_argument("--expected-version")
    parser.add_argument("--expected-app-sha256")
    parser.add_argument("--expected-current-version")
    parser.add_argument("--confirm-production")
    parser.add_argument("--execute", action="store_true")
    parser.add_argument("--self-test", action="store_true", help=argparse.SUPPRESS)
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    if args.self_test:
        self_test()
        return 0
    required = {
        "--manifest-url": args.manifest_url,
        "--expected-source-sha": args.expected_source_sha,
        "--expected-version": args.expected_version,
        "--expected-app-sha256": args.expected_app_sha256,
    }
    missing = [name for name, value in required.items() if not value]
    if missing:
        fail(f"missing required arguments: {', '.join(missing)}")
    manifest = json.loads(request_bytes(cache_busted(args.manifest_url)))
    if not isinstance(manifest, dict):
        fail("manifest is not a JSON object")
    app_url = validate_manifest(
        args.manifest_url, manifest, args.expected_source_sha, args.expected_version,
        args.expected_app_sha256,
    )
    verify_local_source(args.expected_source_sha)
    binary = request_bytes(cache_busted(app_url), timeout=30)
    elf = verify_image(binary, args.expected_version, args.expected_app_sha256)
    run_local_gates()

    inventory = load_inventory()
    bench = inventory[BENCH_ROLE]
    production = inventory[PRODUCTION_ROLE]

    test_before = request_json(bench["host"], "/status")
    validate_identity(test_before, host=bench["host"], mac=bench["mac"], version=args.expected_version, elf=elf)
    if int(test_before.get("uptime_s", MAX_TEST_START_UPTIME_S + 1)) > MAX_TEST_START_UPTIME_S:
        fail("bench must be freshly booted into the exact artifact so the stress overlaps first TLS activity")
    test_evidence = stress_board(
        host=bench["host"], mac=bench["mac"], version=args.expected_version, elf=elf,
        require_x10a=False, require_weather=False,
    )

    result: dict[str, Any] = {
        "artifact": {"version": args.expected_version, "source_sha": args.expected_source_sha,
                     "app_sha256": args.expected_app_sha256, "elf": elf, "channel": "dev",
                     "release_created": False},
        "test_board": {"role": BENCH_ROLE, "host": bench["host"], "mac": bench["mac"],
                       **test_evidence},
        "production": {"executed": False},
    }
    if not args.execute:
        print(json.dumps(result, indent=2, sort_keys=True))
        return 0
    if args.confirm_production != PRODUCTION_ROLE or not args.expected_current_version:
        fail("--execute requires --confirm-production production and --expected-current-version")
    if args.expected_current_version == args.expected_version:
        fail("production already names the target version; refusing a redundant update write")

    production_before = request_json(production["host"], "/status")
    validate_identity(
        production_before, host=production["host"], mac=production["mac"],
        version=args.expected_current_version, elf=str(production_before.get("app_elf_sha256", "")),
    )
    hp_before = production_before.get("hp", {})
    if not hp_before.get("connected") or int(hp_before.get("values", 0)) <= 0:
        fail("production X10A must be live before promotion")
    if not production_before.get("mqtt", {}).get("connected"):
        fail("production MQTT must be connected before promotion")
    wait_for_ota_offer(production["host"], args.expected_version)
    post_update_once(production["host"])
    returned = wait_for_new_firmware(production["host"], args.expected_version, elf)
    validate_identity(returned, host=production["host"], mac=production["mac"], version=args.expected_version, elf=elf)
    production_evidence = stress_board(
        host=production["host"], mac=production["mac"], version=args.expected_version, elf=elf,
        require_x10a=True, require_weather=True,
    )
    final_status = request_json(production["host"], "/status")
    retained = verify_retained_x10a(final_status)
    result["production"] = {
        "executed": True,
        "role": PRODUCTION_ROLE,
        "host": production["host"],
        "mac": production["mac"],
        "previous_version": args.expected_current_version,
        "stress": production_evidence,
        "retained_x10a": retained,
    }
    print(json.dumps(result, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except GateError as error:
        print(f"BLOCKED: {error}", file=sys.stderr)
        raise SystemExit(2)
