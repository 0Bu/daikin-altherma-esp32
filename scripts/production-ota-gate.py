#!/usr/bin/env python3
"""Fail-closed role-pinned OTA delivery gate.

The bench mode is the only agent-approved path to install an ordinary update on the private-inventory
test board. It verifies one exact signed dev artifact, performs at most one POST on the bench role,
waits through rollback probation and then runs the sustained pressure gate. It cannot contact the
production role.

The production mode additionally proves that exact image on the bench role by making it perform a
complete signed release download under concurrent HTTP pressure, restores the exact dev target,
runs the sustained pressure gate, then performs at most one POST on the distinct production role and
observes the canary read-only. Neither mode creates a release or retries a write.
"""

from __future__ import annotations

import argparse
from dataclasses import dataclass
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
from urllib.error import HTTPError
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
OTA_CHECK_TIMEOUT_S = 120
# Firmware permits a 30 s re-manifest plus a five-minute binary deadline after bounded quiesce /
# headroom waits, two verifier passes and reboot. The observer must outlive the only accepted write.
OTA_TIMEOUT_S = 480
OTA_OFFER_POLL_SECONDS = 0.1
# The raw-socket observer explicitly closes each response connection. Keep its in-transfer cadence
# below allocator-churning load and bound every request so completed-state evidence is observable.
OTA_STATUS_POLL_SECONDS = 0.5
OTA_STATUS_REQUEST_TIMEOUT_S = 1.0
OTA_STATUS_MAX_BYTES = 4096
MQTT_RECOVERY_TIMEOUT_S = 15
LEGACY_OFFER_STABLE_SECONDS = 3.0
BENCH_HEALTH_WINDOW_S = 105
BENCH_HEALTH_WINDOW_TIMEOUT_S = 150
DEV_MANIFEST_SUFFIX = "/dev/manifest.json"
OFFICIAL_MANIFEST_URL = "https://0bu.github.io/daikin-altherma-esp32/dev/manifest.json"
OFFICIAL_RELEASE_MANIFEST_URL = "https://0bu.github.io/daikin-altherma-esp32/manifest.json"


class GateError(RuntimeError):
    pass


class CompactTransportError(RuntimeError):
    """A retryable compact-observer disconnect while the board may be rebooting."""


@dataclass(frozen=True)
class ResolvedHttpEndpoint:
    family: int
    socktype: int
    proto: int
    sockaddr: tuple[Any, ...]
    host_header: str


@dataclass
class MqttRecoveryTracker:
    """Classify sampled MQTT gaps without trusting one cross-subsystem status snapshot."""

    weather_successes_seen: int
    weather_expected: bool = False
    weather_deadline: float = 0.0
    pending_disconnects: int = 0
    pending_deadline: float = 0.0

    def observe(
        self, *, now: float, mqtt_connected: bool, weather_fetching: bool,
        weather_successes: int, ota_expected: bool,
    ) -> int:
        failures = 0
        weather_evidence = weather_fetching or weather_successes > self.weather_successes_seen
        weather_was_expected = self.weather_expected
        pending_was_observed = self.pending_disconnects > 0
        # Later owner evidence may explain a still-bounded mixed snapshot, but it must not erase an
        # unexplained gap whose deadline already passed before this sample was observed.
        if self.pending_disconnects and now > self.pending_deadline:
            failures += self.pending_disconnects
            self.pending_disconnects = 0
            self.pending_deadline = 0.0
        if weather_evidence:
            self.weather_expected = True
            self.weather_deadline = now + MQTT_RECOVERY_TIMEOUT_S
            # A streamed status request can straddle the pause and expose old weather fields beside
            # the new MQTT state. Only a subsequent weather owner/success edge may forgive it.
            self.pending_disconnects = 0
            self.pending_deadline = 0.0
        self.weather_successes_seen = max(self.weather_successes_seen, weather_successes)

        if mqtt_connected:
            # Keep an unexplained gap pending for the bounded interval: a following status may be
            # the first consistent snapshot that exposes the weather edge. Without that evidence it
            # still fails at expiry or finish.
            if not weather_evidence or weather_was_expected or pending_was_observed:
                self.weather_expected = False
        elif not ota_expected:
            if self.weather_expected:
                if now > self.weather_deadline:
                    self.weather_expected = False
                    failures += 1
            elif self.pending_disconnects:
                self.pending_disconnects += 1
                if now > self.pending_deadline:
                    failures += self.pending_disconnects
                    self.pending_disconnects = 0
                    self.pending_deadline = 0.0
            else:
                self.pending_disconnects = 1
                self.pending_deadline = now + MQTT_RECOVERY_TIMEOUT_S
        return failures

    def finish(self) -> int:
        failures = self.pending_disconnects
        self.pending_disconnects = 0
        self.pending_deadline = 0.0
        return failures


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


def request_bytes(
    url: str, *, method: str = "GET", timeout: int = HTTP_TIMEOUT_S,
    data: bytes | None = None, content_type: str | None = None,
) -> bytes:
    headers = {"User-Agent": "daikin-production-ota-gate/1"}
    if content_type:
        headers["Content-Type"] = content_type
    request = Request(url, method=method, data=data, headers=headers)
    with urlopen(request, timeout=timeout) as response:
        if response.status < 200 or response.status >= 300:
            fail(f"{method} {url} returned HTTP {response.status}")
        return response.read()


def request_json(
    host: str, path: str, *, method: str = "GET", timeout: int = HTTP_TIMEOUT_S,
    payload: dict[str, Any] | None = None,
) -> dict[str, Any]:
    data = json.dumps(payload, separators=(",", ":")).encode() if payload is not None else None
    raw = request_bytes(
        f"http://{host}{path}", method=method, timeout=timeout, data=data,
        content_type="application/json" if payload is not None else None,
    )
    value = json.loads(raw)
    if not isinstance(value, dict):
        fail(f"{host}{path} did not return a JSON object")
    return value


def resolve_http_endpoint(host: str) -> ResolvedHttpEndpoint:
    """Resolve the board before the sole write so DNS cannot consume completed-state evidence."""
    try:
        addresses = socket.getaddrinfo(host, 80, type=socket.SOCK_STREAM)
    except OSError as error:
        fail(f"could not resolve board host {host}: {error}")
    for family, socktype, proto, _canonical, sockaddr in addresses:
        if family in (socket.AF_INET, socket.AF_INET6):
            return ResolvedHttpEndpoint(family, socktype, proto, sockaddr, host)
    fail(f"board host {host} has no TCP address")


def read_compact_json_response(
    connection: socket.socket, host_header: str, path: str, deadline: float,
) -> dict[str, Any]:
    """Read a fixed-size HTTP response while every receive consumes one absolute deadline."""
    def apply_remaining_timeout() -> None:
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            raise TimeoutError("compact HTTP request exceeded its whole-request deadline")
        connection.settimeout(remaining)

    response = bytearray()
    while b"\r\n\r\n" not in response:
        apply_remaining_timeout()
        chunk = connection.recv(1024)
        if not chunk:
            raise CompactTransportError("compact HTTP response ended before its headers")
        response.extend(chunk)
        if len(response) > OTA_STATUS_MAX_BYTES:
            fail("compact HTTP response headers exceed their fixed bound")

    raw_headers, raw_body = bytes(response).split(b"\r\n\r\n", 1)
    lines = raw_headers.split(b"\r\n")
    status_parts = lines[0].split(b" ", 2)
    if len(status_parts) < 2 or status_parts[0] != b"HTTP/1.1" or \
       not status_parts[1].isdigit():
        fail("compact HTTP response has an invalid status line")
    status = int(status_parts[1])
    content_lengths: list[bytes] = []
    for line in lines[1:]:
        name, separator, value = line.partition(b":")
        if not separator:
            fail("compact HTTP response has a malformed header")
        if name.strip().lower() == b"content-length":
            content_lengths.append(value.strip())
    if status < 200 or status >= 300:
        raise HTTPError(
            f"http://{host_header}{path}", status,
            "compact HTTP request failed", None, None,
        )
    if len(content_lengths) != 1 or not content_lengths[0].isdigit():
        fail("compact HTTP response needs one numeric Content-Length")
    content_length = int(content_lengths[0])
    if content_length > OTA_STATUS_MAX_BYTES or len(raw_body) > content_length:
        fail("compact HTTP response body exceeds its fixed bound")

    body = bytearray(raw_body)
    while len(body) < content_length:
        apply_remaining_timeout()
        chunk = connection.recv(min(1024, content_length - len(body)))
        if not chunk:
            raise CompactTransportError("compact HTTP response ended before its declared body")
        body.extend(chunk)
    apply_remaining_timeout()
    try:
        value = json.loads(body)
    except json.JSONDecodeError as error:
        raise GateError("compact HTTP response has malformed JSON") from error
    if not isinstance(value, dict):
        fail("compact HTTP response is not a JSON object")
    return value


def request_json_deadline(
    endpoint: ResolvedHttpEndpoint, path: str, *, timeout: float,
) -> dict[str, Any]:
    """Read one compact HTTP/1.1 JSON response under a monotonic whole-request deadline."""
    if timeout <= 0 or not path.startswith("/") or any(c in path for c in "\r\n "):
        fail("compact HTTP request arguments are invalid")
    deadline = time.monotonic() + timeout
    connection = socket.socket(endpoint.family, endpoint.socktype, endpoint.proto)

    def apply_remaining_timeout() -> None:
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            raise TimeoutError("compact HTTP request exceeded its whole-request deadline")
        connection.settimeout(remaining)

    try:
        apply_remaining_timeout()
        connection.connect(endpoint.sockaddr)
        request = (
            f"GET {path} HTTP/1.1\r\n"
            f"Host: {endpoint.host_header}\r\n"
            "User-Agent: daikin-production-ota-gate/1\r\n"
            "Accept: application/json\r\n"
            "Connection: close\r\n\r\n"
        ).encode("ascii")
        apply_remaining_timeout()
        connection.sendall(request)
        return read_compact_json_response(
            connection, endpoint.host_header, path, deadline,
        )
    finally:
        connection.close()


def verify_http_range_support(url: str, binary: bytes) -> None:
    """Require the official artifact host to serve the exact one-byte suffix contract firmware uses."""
    if not binary:
        fail("cannot verify Range support for an empty firmware artifact")
    request = Request(
        cache_busted(url), method="GET",
        headers={"User-Agent": "daikin-production-ota-gate/1", "Range": "bytes=0-0"},
    )
    with urlopen(request, timeout=HTTP_TIMEOUT_S) as response:
        content_range = response.headers.get_all("Content-Range") or []
        content_length = response.headers.get("Content-Length")
        if response.status != 206 or content_range != [f"bytes 0-0/{len(binary)}"] or \
           content_length != "1":
            fail("official firmware host does not provide the exact HTTP Range resume contract")
        body = response.read(2)
    if body != binary[:1]:
        fail("official firmware Range response does not match the signed artifact")


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


def validate_release_manifest(manifest_url: str, manifest: dict[str, Any]) -> tuple[str, str, str]:
    """Pin the signed rollback exercise to the one official stable feed."""
    if manifest_url != OFFICIAL_RELEASE_MANIFEST_URL:
        fail("bench rollback exercise requires the official release manifest")
    version = manifest.get("version")
    provenance = manifest.get("provenance")
    if not isinstance(version, str) or not version or "-dev." in version:
        fail("official release manifest does not name a stable version")
    if not isinstance(provenance, dict):
        fail("official release manifest provenance is missing")
    source_sha = provenance.get("source_sha")
    app_sha256 = provenance.get("app_sha256")
    if not isinstance(source_sha, str) or not re.fullmatch(r"[0-9a-f]{40}", source_sha):
        fail("official release source SHA is invalid")
    if not isinstance(app_sha256, str) or not re.fullmatch(r"[0-9a-f]{64}", app_sha256):
        fail("official release application SHA is invalid")
    builds = manifest.get("builds")
    if not isinstance(builds, list):
        fail("official release builds are missing")
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
        fail("official release manifest must name exactly one ESP32-S3 application")
    return version, app_sha256, urljoin(manifest_url, candidates[0])


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
    target = re.search(r"^(?:Detected image type:\s*ESP32-S3|ESP32-S3 Image Header)$",
                       info, re.MULTILINE)
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
    if not started.get("mqtt", {}).get("connected"):
        fail(f"{host} MQTT must be connected before the pressure window")
    if int(started.get("uptime_s", MAX_TEST_START_UPTIME_S + 1)) > MAX_TEST_START_UPTIME_S:
        fail(f"{host} must enter the pressure gate within {MAX_TEST_START_UPTIME_S}s of boot")
    baseline = board_counters(started)
    weather_before = started.get("weather_forecast", {})
    deadline = time.monotonic() + STRESS_SECONDS
    lock = threading.Lock()
    samples: dict[str, int] = {"status": 0, "values": 0, "diag": 0}
    busy_503: dict[str, int] = {"status": 0, "values": 0}
    errors: list[str] = []
    uptimes: list[int] = []
    disconnected = 0
    manifest_active = threading.Event()
    mqtt_recovery_expected = threading.Event()
    mqtt_recovery = MqttRecoveryTracker(int(weather_before.get("successes", 0)))

    def remember(kind: str, error: BaseException) -> None:
        with lock:
            if len(errors) < 20:
                errors.append(f"{kind}: {error}")

    def status_loop() -> None:
        nonlocal disconnected
        while time.monotonic() < deadline:
            try:
                ota_expected_before = mqtt_recovery_expected.is_set()
                status = request_json(host, "/status")
                validate_identity(status, host=host, mac=mac, version=version, elf=elf)
                hp = status.get("hp", {})
                mqtt = status.get("mqtt", {})
                weather = status.get("weather_forecast", {})
                now = time.monotonic()
                weather_successes = int(weather.get("successes", 0))
                # Weather owns the same constrained network heap as OTA and deliberately stops
                # esp-mqtt while its TLS client is live. `fetching` covers the owner interval; the
                # success edge covers the short status-update -> asynchronous MQTT-resume gap. The
                # tracker also defers a straddling mixed snapshot until that evidence can arrive.
                if require_x10a and (not hp.get("connected") or int(hp.get("values", 0)) <= 0):
                    disconnected += 1
                disconnected += mqtt_recovery.observe(
                    now=now,
                    mqtt_connected=bool(mqtt.get("connected")),
                    weather_fetching=bool(weather.get("fetching")),
                    weather_successes=weather_successes,
                    # A request started inside the accepted OTA pause must not be reclassified if
                    # the main thread clears the event before this streamed snapshot is processed.
                    ota_expected=ota_expected_before or mqtt_recovery_expected.is_set(),
                )
                with lock:
                    samples["status"] += 1
                    uptimes.append(int(status.get("uptime_s", -1)))
            except HTTPError as error:
                if error.code == 503 and manifest_active.is_set():
                    with lock:
                        busy_503["status"] += 1
                else:
                    remember("status", error)
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
            except HTTPError as error:
                if kind == "values" and error.code == 503 and manifest_active.is_set():
                    with lock:
                        busy_503["values"] += 1
                else:
                    remember(kind, error)
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
    manifest_active.set()
    mqtt_recovery_expected.set()
    accepted = request_json(host, f"/ota/check?ms={int(time.time() * 1000)}")
    generation = accepted.get("generation")
    if accepted.get("ok") is not True or not isinstance(generation, int) or generation <= 0:
        fail(f"{host} pressure check did not return an accepted OTA generation")
    check_deadline = time.monotonic() + OTA_CHECK_TIMEOUT_S
    ota_check: dict[str, Any] = {}
    while time.monotonic() < check_deadline:
        ota_check = request_json(host, "/ota/status")
        if ota_check.get("generation") != generation:
            fail(f"{host} pressure check generation changed")
        if ota_check.get("busy") is False:
            break
        time.sleep(OTA_OFFER_POLL_SECONDS)
    else:
        fail(f"{host} OTA manifest TLS did not release its busy claim")
    # s_network_active is destroyed before the mutex-protected busy bit is released. Keeping the
    # allowance for one scheduler turn closes an HTTP worker already dispatched on the prior bit.
    time.sleep(0.25)
    manifest_active.clear()
    mqtt_recovery_deadline = time.monotonic() + MQTT_RECOVERY_TIMEOUT_S
    mqtt_recovery_error = "still disconnected"
    while time.monotonic() < mqtt_recovery_deadline:
        try:
            mqtt_recovery_status = request_json(host, "/status", timeout=1)
        except (OSError, TimeoutError, json.JSONDecodeError) as error:
            mqtt_recovery_error = str(error)
            time.sleep(0.1)
            continue
        validate_identity(mqtt_recovery_status, host=host, mac=mac, version=version, elf=elf)
        if mqtt_recovery_status.get("mqtt", {}).get("connected"):
            mqtt_recovery_expected.clear()
            break
        time.sleep(0.1)
    else:
        fail(
            f"{host} MQTT did not recover after OTA TLS within {MQTT_RECOVERY_TIMEOUT_S}s: "
            f"{mqtt_recovery_error}"
        )
    for worker in workers:
        worker.join(STRESS_SECONDS + HTTP_TIMEOUT_S + 10)

    # No future weather edge can justify a sample after the pressure workers have stopped.
    disconnected += mqtt_recovery.finish()

    finished = request_json(host, "/status")
    validate_identity(finished, host=host, mac=mac, version=version, elf=elf)
    if ota_check.get("state") != "idle" or ota_check.get("available") != version:
        fail(f"{host} OTA manifest TLS did not finish cleanly on the exact dev version")
    if not finished.get("mqtt", {}).get("connected"):
        fail(f"{host} MQTT was not connected after the pressure window")
    final = board_counters(finished)
    if errors:
        fail(f"{host} live stress had errors: {'; '.join(errors)}")
    if samples["status"] < MIN_STATUS_SAMPLES or samples["values"] < MIN_VALUES_SAMPLES or samples["diag"] < MIN_DIAG_SAMPLES:
        fail(f"{host} live stress produced too few successful samples: {samples}")
    if busy_503["status"] <= 0 or busy_503["values"] <= 0:
        fail(f"{host} did not prove fast status/values refusal during OTA TLS: {busy_503}")
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
        "ota_busy_503": busy_503,
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


def ota_offer_ready(
    status: dict[str, Any], expected_version: str, expected_app_sha256: str,
    expected_generation: int, expected_channel: str = "dev",
    allow_downgrade: bool = False,
) -> bool:
    """Accept only the completed status of the exact synchronously accepted check task."""
    generation = status.get("generation")
    if not isinstance(generation, int) or generation != expected_generation:
        fail("OTA operation generation changed during offer check")
    if status.get("busy") is True:
        return False
    if status.get("busy") is not False:
        fail("firmware does not expose the required OTA busy handshake")
    if status.get("state") == "error":
        fail(f"OTA check failed: {status.get('message', '')}")
    if status.get("state") != "idle" or not status.get("available"):
        return False
    if status.get("available") != expected_version or \
       status.get("available_sha256") != expected_app_sha256 or \
       status.get("available_channel") != expected_channel or \
       not (status.get("update_available") or
            (allow_downgrade and status.get("downgrade"))):
        fail("board did not offer the exact gated artifact")
    return True


def wait_for_ota_offer(
    host: str, expected_version: str, expected_app_sha256: str,
    *, expected_channel: str = "dev", allow_downgrade: bool = False,
) -> int:
    try:
        accepted = request_json(host, f"/ota/check?ms={int(time.time() * 1000)}")
    except HTTPError as error:
        fail(f"firmware refused OTA check with HTTP {error.code}")
    generation = accepted.get("generation")
    if accepted.get("ok") is not True or not isinstance(generation, int) or generation <= 0:
        fail(
            "firmware lacks or refused the OTA generation handshake; "
            "use one signed NVS-preserving USB bootstrap — no update POST was sent"
        )
    deadline = time.monotonic() + OTA_CHECK_TIMEOUT_S
    while time.monotonic() < deadline:
        status = request_json(host, "/ota/status")
        if ota_offer_ready(
            status, expected_version, expected_app_sha256, generation,
            expected_channel, allow_downgrade,
        ):
            return generation
        time.sleep(OTA_OFFER_POLL_SECONDS)
    fail(f"OTA check did not settle on the exact gated artifact within {OTA_CHECK_TIMEOUT_S} seconds")


def post_update_once(
    host: str, check_generation: int, expected_version: str, expected_app_sha256: str,
    *, expected_channel: str = "dev", allow_downgrade: bool = False,
) -> int:
    # Deliberately one un-retried exact-artifact write per invocation. A bench install invokes this
    # once; production promotion additionally uses it only inside its inventory-pinned stages.
    fields = {
        "after": check_generation,
        "channel": expected_channel,
        "version": expected_version,
        "sha256": expected_app_sha256,
    }
    if allow_downgrade:
        fields["downgrade"] = "1"
    query = urlencode(fields)
    try:
        accepted = request_json(host, f"/ota/update?{query}", method="POST", timeout=HTTP_TIMEOUT_S)
    except HTTPError as error:
        fail(f"firmware refused the sole OTA update write with HTTP {error.code}")
    generation = accepted.get("generation")
    if accepted.get("ok") is not True or not isinstance(generation, int) or generation <= 0:
        fail("firmware did not accept the sole OTA update write")
    expected_generation = 1 if check_generation == 0xFFFFFFFF else check_generation + 1
    if generation != expected_generation:
        fail("OTA update did not receive the immediate successor generation")
    return generation


def wait_for_new_firmware(
    host: str, version: str, elf: str, status_endpoint: ResolvedHttpEndpoint,
    ota_evidence: dict[str, Any] | None = None,
) -> dict[str, Any]:
    deadline = time.monotonic() + OTA_TIMEOUT_S
    saw_done = False
    while time.monotonic() < deadline:
        try:
            ota = request_json_deadline(
                status_endpoint, "/ota/status", timeout=OTA_STATUS_REQUEST_TIMEOUT_S,
            )
            if ota.get("state") == "error":
                fail(f"OTA failed: {ota.get('message', '')}")
            saw_done = saw_done or ota.get("state") == "done"
            if ota_evidence is not None:
                for source, target in (
                    ("heap_min_free_bytes", "heap_min_free_bytes"),
                    ("heap_min_largest_block_bytes", "heap_min_largest_block_bytes"),
                ):
                    value = ota.get(source)
                    if isinstance(value, int) and value > 0:
                        previous = ota_evidence.get(target)
                        ota_evidence[target] = value if not isinstance(previous, int) \
                            else min(previous, value)
                ota_evidence["saw_done"] = saw_done
            # The firmware intentionally refuses the allocation-rich /status surface while its
            # TLS owner is active. Observe progress only through compact /ota/status, and ask for
            # full identity after the old process has stopped being busy (normally the new boot's
            # idle status). A 503 is an expected proof of the heap gate, not an OTA failure.
            if ota.get("state") not in ("checking", "updating", "done"):
                status = request_json(host, "/status")
                if status.get("version") == version and status.get("app_elf_sha256") == elf:
                    return status
        except HTTPError as error:
            if error.code != 503:
                raise
        except (CompactTransportError, OSError, TimeoutError):
            pass  # expected only while the one accepted update reboots; never retried as a write
        time.sleep(OTA_STATUS_POLL_SECONDS)
    fail(f"board did not return on {version}/{elf}; OTA done observed={saw_done}")


def set_update_channel(host: str, channel: str) -> None:
    response = request_json(host, "/set_ota", method="POST", payload={"channel": channel})
    if response.get("ok") is not True:
        fail(f"{host} refused update channel {channel}")
    status = request_json(host, "/status")
    if status.get("ota", {}).get("channel") != channel:
        fail(f"{host} did not persist update channel {channel}")


def wait_for_bench_health_window(
    host: str, mac: str, version: str, elf: str, *, phase: str,
) -> dict[str, Any]:
    """Require one exact bench image to remain healthy beyond the rollback commit window.

    ESP-IDF forbids writing the other OTA slot while the running image is still PENDING_VERIFY.
    The bench deliberately has no X10A, so its normal connected/heap/no-allocation-failure proof
    commits at the 90-second base window after an OTA boot.  A USB-installed target is not rollback
    armed, but receives the same conservative 105-second health dwell.  We cannot read IDF's
    partition state through an old release API, so the following real OTA start remains the
    authoritative proof and fails closed if an OTA-installed image remained unconfirmed.
    """
    if phase not in ("target", "release"):
        fail(f"invalid bench health-window phase {phase}")
    deadline = time.monotonic() + BENCH_HEALTH_WINDOW_TIMEOUT_S
    while time.monotonic() < deadline:
        status = request_json(host, "/status")
        validate_identity(
            status, host=host, mac=mac, version=version, elf=elf,
        )
        counters = board_counters(status)
        system = status.get("sys", {})
        if int(status.get("uptime_s", 0)) >= BENCH_HEALTH_WINDOW_S:
            if any(counters[key] != 0 for key in ("heap_restarts", "mqtt_skipped", "poll_skipped")):
                fail(f"{host} {phase} health window recorded an allocation failure: {counters}")
            if int(system.get("free_heap", 0)) < MIN_FINAL_FREE_HEAP or \
               int(system.get("max_alloc", 0)) < MIN_FINAL_LARGEST_BLOCK:
                fail(f"{host} {phase} reached the health window without safe heap")
            return status
        time.sleep(1)
    fail(f"{host} {phase} did not survive the bench health window")


def wait_for_legacy_offer(host: str, expected_version: str) -> None:
    deadline = time.monotonic() + OTA_CHECK_TIMEOUT_S
    stable_since: float | None = None
    while time.monotonic() < deadline:
        status = request_json(host, "/ota/status")
        if status.get("state") == "error":
            fail(f"legacy bench OTA check failed: {status.get('message', '')}")
        if status.get("state") == "idle" and status.get("available") == expected_version and \
           status.get("update_available") is True:
            now = time.monotonic()
            if stable_since is None:
                stable_since = now
            elif now - stable_since >= LEGACY_OFFER_STABLE_SECONDS:
                return
        else:
            stable_since = None
        time.sleep(OTA_OFFER_POLL_SECONDS)
    fail("legacy bench OTA check did not settle on the exact dev version")


def exercise_bench_full_download(
    *, host: str, mac: str, target_version: str, target_sha256: str, target_elf: str,
    release_version: str, release_sha256: str, release_elf: str,
) -> dict[str, Any]:
    """Make the target firmware itself perform one complete signed binary TLS transfer.

    The exact target first switches to the official release feed and installs that older signed
    build under concurrent HTTP pressure. The release then restores the exact official dev target.
    This happens only on the private-inventory bench role and closes the old manifest-only gap.
    """
    if release_version == target_version:
        fail("bench full-download exercise needs a release distinct from the target")
    status_endpoint = resolve_http_endpoint(host)
    set_update_channel(host, "release")
    generation = wait_for_ota_offer(
        host, release_version, release_sha256,
        expected_channel="release", allow_downgrade=True,
    )

    stop = threading.Event()
    lock = threading.Lock()
    counts: dict[str, int] = {}
    unexpected: list[str] = []

    def bump(key: str) -> None:
        with lock:
            counts[key] = counts.get(key, 0) + 1

    def probe(path: str, kind: str, interval: float) -> None:
        while not stop.is_set():
            try:
                raw = request_bytes(f"http://{host}{path}")
                if kind in ("status", "values", "ota_status"):
                    json.loads(raw)
                elif not raw:
                    fail("empty diagnostic response during bench binary pressure")
                bump(f"{kind}_ok")
            except HTTPError as error:
                if kind in ("status", "values") and error.code == 503:
                    bump(f"{kind}_busy_503")
                else:
                    with lock:
                        if len(unexpected) < 20:
                            unexpected.append(f"{kind}: HTTP {error.code}")
            except (OSError, TimeoutError, json.JSONDecodeError):
                # A short disconnect is mandatory when the signed release boots.
                bump(f"{kind}_reboot_gap")
            stop.wait(interval)

    workers = [
        threading.Thread(target=probe, args=("/status", "status", 0.25), daemon=True),
        threading.Thread(target=probe, args=("/values", "values", 0.50), daemon=True),
        threading.Thread(target=probe, args=("/diag", "diag", 1.00), daemon=True),
        threading.Thread(target=probe, args=("/ota/status", "ota_status", 0.20), daemon=True),
    ]
    for worker in workers:
        worker.start()
    time.sleep(0.5)

    target_transfer: dict[str, Any] = {}
    try:
        post_update_once(
            host, generation, release_version, release_sha256,
            expected_channel="release", allow_downgrade=True,
        )
        release_status = wait_for_new_firmware(
            host, release_version, release_elf, status_endpoint, target_transfer,
        )
    finally:
        stop.set()
        for worker in workers:
            worker.join(HTTP_TIMEOUT_S + 2)

    validate_identity(
        release_status, host=host, mac=mac, version=release_version, elf=release_elf,
    )
    if unexpected:
        fail(f"{host} bench binary pressure had unexpected HTTP failures: {'; '.join(unexpected)}")
    for key in ("status_busy_503", "values_busy_503", "diag_ok", "ota_status_ok"):
        if counts.get(key, 0) <= 0:
            fail(f"{host} bench binary pressure did not prove {key}: {counts}")
    if int(target_transfer.get("heap_min_free_bytes", 0)) <= 0 or \
       int(target_transfer.get("heap_min_largest_block_bytes", 0)) <= 0:
        fail(f"{host} target OTA did not expose sampled operation-local heap minima")
    if target_transfer.get("saw_done") is not True:
        fail(f"{host} target OTA never exposed its completed validation state")

    release_health_window = wait_for_bench_health_window(
        host, mac, release_version, release_elf, phase="release",
    )

    # Restore the exact target from the official dev feed. Current releases use the atomic
    # generation handshake; an older still-supported release may predate it, so only this BENCH
    # return leg accepts its legacy one-shot endpoint. Final version+ELF identity remains exact.
    set_update_channel(host, "dev")
    accepted = request_json(host, f"/ota/check?ms={int(time.time() * 1000)}")
    restore_generation = accepted.get("generation")
    if isinstance(restore_generation, int) and restore_generation > 0:
        deadline = time.monotonic() + OTA_CHECK_TIMEOUT_S
        while time.monotonic() < deadline:
            status = request_json(host, "/ota/status")
            if ota_offer_ready(
                status, target_version, target_sha256, restore_generation, "dev", False,
            ):
                break
            time.sleep(OTA_OFFER_POLL_SECONDS)
        else:
            fail("bench return check did not settle on the exact dev artifact")
        post_update_once(host, restore_generation, target_version, target_sha256)
    else:
        if accepted.get("ok") is not True:
            fail("legacy bench firmware refused the dev return check")
        wait_for_legacy_offer(host, target_version)
        # Exactly one un-retried BENCH restore write; production never uses this legacy endpoint.
        restored = request_json(host, "/ota/update", method="POST")
        if restored.get("ok") is not True:
            fail("legacy bench firmware refused the dev return update")

    restore_transfer: dict[str, Any] = {}
    target_status = wait_for_new_firmware(
        host, target_version, target_elf, status_endpoint, restore_transfer,
    )
    validate_identity(
        target_status, host=host, mac=mac, version=target_version, elf=target_elf,
    )
    return {
        "release_version": release_version,
        "release_elf": release_elf,
        "release_health_window_uptime_s": release_health_window.get("uptime_s"),
        "pressure": counts,
        "target_download_heap": target_transfer,
        "restore_download_heap": restore_transfer,
        "returned_version": target_status.get("version"),
        "returned_elf": target_status.get("app_elf_sha256"),
    }


def require_ota_transfer_evidence(host: str, evidence: dict[str, Any], *, phase: str) -> None:
    """Require the completed verifier and operation-local heap minima from one OTA write."""
    if int(evidence.get("heap_min_free_bytes", 0)) <= 0 or \
       int(evidence.get("heap_min_largest_block_bytes", 0)) <= 0:
        fail(f"{host} {phase} OTA did not expose sampled operation-local heap minima")
    if evidence.get("saw_done") is not True:
        fail(f"{host} {phase} OTA never exposed its completed validation state")


def install_bench_target(
    *, host: str, mac: str, current_version: str, target_version: str,
    target_sha256: str, target_elf: str,
) -> dict[str, Any]:
    """Install exactly one signed dev artifact on the inventory-pinned bench role.

    This function has no production-board argument by construction. It owns one un-retried update
    write, then all remaining acceptance is read-only.
    """
    status_endpoint = resolve_http_endpoint(host)
    before = request_json(host, "/status")
    current_elf = str(before.get("app_elf_sha256", ""))
    if re.fullmatch(r"[0-9a-f]{9}", current_elf) is None:
        fail("bench does not expose a valid current ELF identity")
    validate_identity(
        before, host=host, mac=mac, version=current_version, elf=current_elf,
    )
    if current_version == target_version:
        fail("bench already names the target version; refusing a redundant update write")
    if before.get("ota", {}).get("channel") != "dev":
        fail("bench must already follow the official dev channel")
    if not before.get("mqtt", {}).get("connected"):
        fail("bench MQTT must be connected before OTA")
    counters = board_counters(before)
    if any(counters[key] != 0 for key in ("heap_restarts", "mqtt_skipped", "poll_skipped")):
        fail(f"bench already reports an allocation failure before OTA: {counters}")
    system = before.get("sys", {})
    if int(system.get("free_heap", 0)) < MIN_FINAL_FREE_HEAP or \
       int(system.get("max_alloc", 0)) < MIN_FINAL_LARGEST_BLOCK:
        fail("bench does not have safe heap before OTA")

    check_generation = wait_for_ota_offer(host, target_version, target_sha256)
    update_generation = post_update_once(
        host, check_generation, target_version, target_sha256,
    )
    transfer: dict[str, Any] = {}
    returned = wait_for_new_firmware(
        host, target_version, target_elf, status_endpoint, transfer,
    )
    validate_identity(
        returned, host=host, mac=mac, version=target_version, elf=target_elf,
    )
    if returned.get("sys", {}).get("reset_reason") != "sw":
        fail("bench target did not return from the expected software OTA reboot")
    require_ota_transfer_evidence(host, transfer, phase="bench target")
    health_window = wait_for_bench_health_window(
        host, mac, target_version, target_elf, phase="target",
    )
    stress = stress_board(
        host=host, mac=mac, version=target_version, elf=target_elf,
        require_x10a=False, require_weather=False,
    )
    return {
        "role": BENCH_ROLE,
        "executed": True,
        "previous_version": current_version,
        "check_generation": check_generation,
        "update_generation": update_generation,
        "ota_download_heap": transfer,
        "target_health_window_uptime_s": health_window.get("uptime_s"),
        "stress": stress,
    }


def self_test() -> None:
    source = "a" * 40
    app = "b" * 64
    fixture = {
        "version": "1.2.3-dev.4",
        "provenance": {"source_sha": source, "app_sha256": app},
        "builds": [{"chipFamily": "ESP32-S3", "parts": [{"path": "app.bin", "offset": 0x20000}]}],
    }
    assert validate_manifest(OFFICIAL_MANIFEST_URL, fixture, source, "1.2.3-dev.4", app) == "https://0bu.github.io/daikin-altherma-esp32/dev/app.bin"
    release_fixture = {
        **fixture,
        "version": "1.2.3",
        "provenance": {"source_sha": source, "app_sha256": app},
    }
    assert validate_release_manifest(
        OFFICIAL_RELEASE_MANIFEST_URL, release_fixture,
    ) == ("1.2.3", app, "https://0bu.github.io/daikin-altherma-esp32/app.bin")
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
    straddled = MqttRecoveryTracker(weather_successes_seen=0)
    assert straddled.observe(
        now=1.0, mqtt_connected=False, weather_fetching=False,
        weather_successes=0, ota_expected=False,
    ) == 0
    assert straddled.observe(
        now=2.0, mqtt_connected=True, weather_fetching=False,
        weather_successes=1, ota_expected=False,
    ) == 0
    assert straddled.finish() == 0
    reverse_straddled = MqttRecoveryTracker(weather_successes_seen=0)
    assert reverse_straddled.observe(
        now=1.0, mqtt_connected=True, weather_fetching=False,
        weather_successes=1, ota_expected=False,
    ) == 0
    assert reverse_straddled.observe(
        now=2.0, mqtt_connected=False, weather_fetching=False,
        weather_successes=1, ota_expected=False,
    ) == 0
    assert reverse_straddled.observe(
        now=3.0, mqtt_connected=True, weather_fetching=False,
        weather_successes=1, ota_expected=False,
    ) == 0
    assert reverse_straddled.finish() == 0
    unexplained = MqttRecoveryTracker(weather_successes_seen=0)
    assert unexplained.observe(
        now=1.0, mqtt_connected=False, weather_fetching=False,
        weather_successes=0, ota_expected=False,
    ) == 0
    assert unexplained.observe(
        now=2.0, mqtt_connected=True, weather_fetching=False,
        weather_successes=0, ota_expected=False,
    ) == 0
    assert unexplained.observe(
        now=17.0, mqtt_connected=True, weather_fetching=False,
        weather_successes=0, ota_expected=False,
    ) == 1
    late_weather_evidence = MqttRecoveryTracker(weather_successes_seen=0)
    assert late_weather_evidence.observe(
        now=1.0, mqtt_connected=False, weather_fetching=False,
        weather_successes=0, ota_expected=False,
    ) == 0
    assert late_weather_evidence.observe(
        now=17.1, mqtt_connected=True, weather_fetching=False,
        weather_successes=1, ota_expected=False,
    ) == 1
    assert late_weather_evidence.finish() == 0
    ota_event_straddled = MqttRecoveryTracker(weather_successes_seen=0)
    assert ota_event_straddled.observe(
        now=1.0, mqtt_connected=False, weather_fetching=False,
        weather_successes=0, ota_expected=True,
    ) == 0
    assert ota_event_straddled.observe(
        now=2.0, mqtt_connected=True, weather_fetching=False,
        weather_successes=0, ota_expected=False,
    ) == 0
    assert ota_event_straddled.finish() == 0
    later_outage = MqttRecoveryTracker(weather_successes_seen=0)
    assert later_outage.observe(
        now=1.0, mqtt_connected=False, weather_fetching=True,
        weather_successes=0, ota_expected=False,
    ) == 0
    assert later_outage.observe(
        now=2.0, mqtt_connected=True, weather_fetching=False,
        weather_successes=1, ota_expected=False,
    ) == 0
    assert later_outage.observe(
        now=3.0, mqtt_connected=False, weather_fetching=False,
        weather_successes=1, ota_expected=False,
    ) == 0
    assert later_outage.finish() == 1
    checking = {"state": "checking", "busy": True, "generation": 7, "available": ""}
    offered = {"state": "idle", "busy": False, "generation": 7,
               "available": "1.2.3-dev.4", "available_sha256": app,
               "available_channel": "dev", "update_available": True}
    assert not ota_offer_ready(checking, "1.2.3-dev.4", app, 7)
    assert ota_offer_ready(offered, "1.2.3-dev.4", app, 7)
    try:
        ota_offer_ready({**offered, "generation": 8}, "1.2.3-dev.4", app, 7)
    except GateError:
        pass
    else:
        raise AssertionError("a concurrent OTA generation replaced the accepted check")
    for changed in (
        {**offered, "available_sha256": "f" * 64},
        {**offered, "available_channel": "release"},
    ):
        try:
            ota_offer_ready(changed, "1.2.3-dev.4", app, 7)
        except GateError:
            pass
        else:
            raise AssertionError("a different OTA artifact identity passed the completed check")

    # Each response fragment arrives inside the socket timeout, but the complete response does not.
    # This deterministically distinguishes the monotonic whole-request deadline from urllib's
    # per-socket-operation timeout semantics without contacting a board or external service.
    drip_client, drip_server = socket.socketpair()

    def slow_drip() -> None:
        try:
            with drip_server:
                drip_server.recv(4096)
                for part in (
                    b"HTTP/1.1 200 OK\r\n",
                    b"Content-Type: application/json\r\nContent-Length: 2\r\n",
                    b"\r\n",
                    b"{}",
                ):
                    time.sleep(0.12)
                    drip_server.sendall(part)
        except OSError:
            pass  # the deadline closes the socket while the fixture is still dripping

    drip_thread = threading.Thread(target=slow_drip, daemon=True)
    drip_thread.start()
    drip_started = time.monotonic()
    try:
        drip_client.sendall(b"GET /ota/status HTTP/1.1\r\n\r\n")
        read_compact_json_response(
            drip_client, "fixture.invalid", "/ota/status", drip_started + 0.25,
        )
    except TimeoutError:
        pass
    else:
        raise AssertionError("compact status slow-drip exceeded its whole-request deadline")
    finally:
        drip_client.close()
    drip_elapsed = time.monotonic() - drip_started
    drip_thread.join(1.0)
    assert drip_elapsed < 0.7

    # A board can close the compact observer immediately before or during its response while the
    # successful OTA reboots. Those transport EOFs are retryable; complete malformed responses are
    # still hard GateError failures in the parser above.
    for partial_response in (
        b"",
        b"HTTP/1.1 200 OK\r\nContent-Length: 4\r\n\r\n{}",
    ):
        eof_client, eof_server = socket.socketpair()
        with eof_server:
            if partial_response:
                eof_server.sendall(partial_response)
        try:
            read_compact_json_response(
                eof_client, "fixture.invalid", "/ota/status", time.monotonic() + 0.25,
            )
        except CompactTransportError:
            pass
        else:
            raise AssertionError("compact status EOF was not classified as retryable")
        finally:
            eof_client.close()

    for malformed_response in (
        b"HTP/1.1 200 OK\r\nContent-Length: 2\r\n\r\n{}",
        b"HTTP/1.1 200 OK\r\nContent-Length: 1\r\n\r\n{",
    ):
        malformed_client, malformed_server = socket.socketpair()
        with malformed_server:
            malformed_server.sendall(malformed_response)
        try:
            read_compact_json_response(
                malformed_client, "fixture.invalid", "/ota/status", time.monotonic() + 0.25,
            )
        except GateError:
            pass
        else:
            raise AssertionError("complete malformed compact status was not rejected")
        finally:
            malformed_client.close()

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
    parser = argparse.ArgumentParser(description=__doc__, allow_abbrev=False)
    parser.add_argument("--manifest-url")
    parser.add_argument("--expected-source-sha")
    parser.add_argument("--expected-version")
    parser.add_argument("--expected-app-sha256")
    parser.add_argument("--expected-current-version")
    parser.add_argument("--confirm-bench")
    parser.add_argument("--confirm-production")
    parser.add_argument("--install-bench", action="store_true")
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
    verify_http_range_support(app_url, binary)
    run_local_gates()

    inventory = load_inventory()
    bench = inventory[BENCH_ROLE]
    if args.install_bench or args.confirm_bench is not None:
        if not args.install_bench or args.execute or args.confirm_bench != BENCH_ROLE or \
           args.confirm_production is not None or not args.expected_current_version:
            fail(
                "bench delivery requires --install-bench, --confirm-bench bench and "
                "--expected-current-version, without --execute or --confirm-production"
            )
        bench_evidence = install_bench_target(
            host=bench["host"], mac=bench["mac"],
            current_version=args.expected_current_version,
            target_version=args.expected_version,
            target_sha256=args.expected_app_sha256,
            target_elf=elf,
        )
        result = {
            "artifact": {
                "version": args.expected_version,
                "source_sha": args.expected_source_sha,
                "app_sha256": args.expected_app_sha256,
                "elf": elf,
                "channel": "dev",
                "release_created": False,
            },
            "test_board": {"host": bench["host"], "mac": bench["mac"], **bench_evidence},
            "production": {"executed": False},
        }
        print(json.dumps(result, indent=2, sort_keys=True))
        return 0

    release_manifest = json.loads(request_bytes(cache_busted(OFFICIAL_RELEASE_MANIFEST_URL)))
    if not isinstance(release_manifest, dict):
        fail("official release manifest is not a JSON object")
    release_version, release_sha256, release_url = validate_release_manifest(
        OFFICIAL_RELEASE_MANIFEST_URL, release_manifest,
    )
    release_binary = request_bytes(cache_busted(release_url), timeout=30)
    release_elf = verify_image(release_binary, release_version, release_sha256)
    verify_http_range_support(release_url, release_binary)

    production = inventory[PRODUCTION_ROLE]

    test_before = request_json(bench["host"], "/status")
    validate_identity(test_before, host=bench["host"], mac=bench["mac"], version=args.expected_version, elf=elf)
    target_health_window = wait_for_bench_health_window(
        bench["host"], bench["mac"], args.expected_version, elf, phase="target",
    )
    full_download_evidence = exercise_bench_full_download(
        host=bench["host"], mac=bench["mac"],
        target_version=args.expected_version, target_sha256=args.expected_app_sha256,
        target_elf=elf, release_version=release_version, release_sha256=release_sha256,
        release_elf=release_elf,
    )
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
                       "target_health_window_uptime_s": target_health_window.get("uptime_s"),
                       "full_binary_download": full_download_evidence, **test_evidence},
        "production": {"executed": False},
    }
    if not args.execute:
        print(json.dumps(result, indent=2, sort_keys=True))
        return 0
    if args.confirm_production != PRODUCTION_ROLE or not args.expected_current_version:
        fail("--execute requires --confirm-production production and --expected-current-version")
    if args.expected_current_version == args.expected_version:
        fail("production already names the target version; refusing a redundant update write")

    production_status_endpoint = resolve_http_endpoint(production["host"])
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
    check_generation = wait_for_ota_offer(
        production["host"], args.expected_version, args.expected_app_sha256,
    )
    post_update_once(
        production["host"], check_generation, args.expected_version, args.expected_app_sha256,
    )
    returned = wait_for_new_firmware(
        production["host"], args.expected_version, elf, production_status_endpoint,
    )
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
