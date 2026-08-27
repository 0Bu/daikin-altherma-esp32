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
import base64
from contextlib import contextmanager
from dataclasses import dataclass
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import socket
import ssl
import stat
import struct
import subprocess
import sys
import tempfile
import threading
import time
from typing import Any
from urllib.parse import quote, urlencode, urljoin, urlparse, urlunparse
from urllib.error import HTTPError
from urllib.request import HTTPRedirectHandler, Request, build_opener, urlopen


ROOT = Path(__file__).resolve().parents[1]
BENCH_ROLE = "bench"
PRODUCTION_ROLE = "production"
RELEASE_HIL_ROLE = "release-hil"
INVENTORY_PATH = Path(os.environ.get("XDG_CONFIG_HOME", Path.home() / ".config")) / \
    "daikin-altherma-esp32/production-ota.json"
RELEASE_HIL_INVENTORY_PATH = Path(
    os.environ.get("XDG_CONFIG_HOME", Path.home() / ".config")
) / "daikin-altherma-esp32/release-hil.json"
RELEASE_HIL_POLICY_PATH = Path("/etc/daikin-altherma-esp32/release-hil-policy.json")
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
HTTP_HEADER_MAX_BYTES = 4096
HTTP_CHUNK_LINE_MAX_BYTES = 64
STATUS_MAX_BYTES = 32 * 1024
VALUES_MAX_BYTES = 128 * 1024
DIAG_MAX_BYTES = 8 * 1024
MQTT_RECOVERY_TIMEOUT_S = 15
LEGACY_OFFER_STABLE_SECONDS = 3.0
BENCH_HEALTH_WINDOW_S = 105
BENCH_HEALTH_WINDOW_TIMEOUT_S = 150
DEV_MANIFEST_SUFFIX = "/dev/manifest.json"
OFFICIAL_MANIFEST_URL = "https://0bu.github.io/daikin-altherma-esp32/dev/manifest.json"
OFFICIAL_RELEASE_MANIFEST_URL = "https://0bu.github.io/daikin-altherma-esp32/manifest.json"
OFFICIAL_RELEASE_FIRMWARE_BASE_URL = "https://0bu.github.io/daikin-altherma-esp32/"
CONTROL_RESPONSE_MAX_BYTES = 4096
FEED_LEASE_TTL_S = 120
FEED_LEASE_RENEW_S = 30
POWER_OFF_LEASE_S = 15
PENDING_IMAGE_WATCHDOG_TTL_S = 80
PENDING_IMAGE_WATCHDOG_OFF_S = 2
HIL_MANIFEST_HEADER = "X-Daikin-HIL-Manifest-URL"
HIL_FIRMWARE_BASE_HEADER = "X-Daikin-HIL-Firmware-Base-URL"
HIL_FEED_HEADERS = frozenset((HIL_MANIFEST_HEADER, HIL_FIRMWARE_BASE_HEADER))
HIL_FEED_URL_MAX_BYTES = 255
RELEASE_HIL_MANIFEST_MAX_BYTES = 1024
RELEASE_HIL_APP_MAX_BYTES = 0x1F0000
# The oldest supported signed release used by the ordinary bench full-download cycle reads one
# fixed 1024-byte manifest frame. Any larger dev manifest must fail before the gate contacts a
# board, otherwise the release could be installed successfully and then be unable to restore dev.
LEGACY_BENCH_RESTORE_MANIFEST_MAX_BYTES = 1024
# Historical root-feed adjudication: this exact signed 1.0.2 artifact was republished from a later
# source commit while the immutable v1.0.2 tag remained at its original commit. Future stable feeds
# must match their tag; only this complete version/source/app tuple is accepted as the known legacy
# restore writer.
LEGACY_RELEASE_VERSION = "1.0.2"
LEGACY_RELEASE_SOURCE_SHA = "cc29e8c6e593570140e6446b07520216251939ed"
LEGACY_RELEASE_APP_SHA256 = "c8437cb546175fa9591dcce9e137c35ec6ea3028c64678b08e029392cb9ea4ce"
# /status exposes the first nine characters of this signed release image's ELF SHA-256.
LEGACY_RELEASE_ELF_ID = "123d9f795"


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


def strict_json(payload: str | bytes, label: str) -> Any:
    """Decode unambiguous JSON: duplicate keys and non-finite constants are invalid evidence."""
    def unique_object(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
        result: dict[str, Any] = {}
        for key, value in pairs:
            if key in result:
                raise ValueError(f"duplicate key {key!r}")
            result[key] = value
        return result

    def reject_constant(value: str) -> Any:
        raise ValueError(f"non-finite constant {value}")

    try:
        return json.loads(
            payload, object_pairs_hook=unique_object, parse_constant=reject_constant,
        )
    except (UnicodeError, json.JSONDecodeError, ValueError) as error:
        fail(f"{label} is invalid JSON: {error}")


def load_inventory(path: Path = INVENTORY_PATH) -> dict[str, dict[str, str]]:
    try:
        raw_text = path.read_text()
    except (OSError, UnicodeError) as error:
        fail(f"local board inventory {path} is missing or invalid: {error}")
    raw = strict_json(raw_text, f"local board inventory {path}")
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


def load_secure_json(
    path: Path, label: str, *, require_root_owner: bool,
) -> dict[str, Any]:
    """Read one non-link, non-writable policy/inventory below a protected directory."""
    path = path.absolute()
    try:
        parent_status = os.lstat(path.parent)
    except OSError as error:
        fail(f"{label} parent is unavailable: {error}")
    allowed_owner = {0} if require_root_owner else {0, os.getuid()}
    if not stat.S_ISDIR(parent_status.st_mode) or stat.S_ISLNK(parent_status.st_mode) or \
       parent_status.st_uid not in allowed_owner or parent_status.st_mode & 0o022:
        fail(f"{label} parent must be a protected non-symlink directory")
    flags = os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0)
    try:
        descriptor = os.open(path, flags)
    except OSError as error:
        fail(f"{label} is missing or unsafe: {error}")
    try:
        status = os.fstat(descriptor)
        if not stat.S_ISREG(status.st_mode) or status.st_uid not in allowed_owner or \
           status.st_mode & 0o022:
            fail(f"{label} must be a protected regular file")
        with os.fdopen(descriptor, encoding="utf-8") as handle:
            descriptor = -1
            raw_text = handle.read()
    except (OSError, UnicodeError) as error:
        fail(f"{label} is invalid: {error}")
    finally:
        if descriptor >= 0:
            os.close(descriptor)
    raw = strict_json(raw_text, label)
    if not isinstance(raw, dict):
        fail(f"{label} must be a JSON object")
    return raw


def canonical_https_url(
    value: Any, label: str, *, directory: bool, required_suffix: str | None = None,
):
    """Validate one controller/feed URL without leaving normalization choices to urljoin."""
    parsed = urlparse(value) if isinstance(value, str) else None
    if not parsed or not value.isascii() or parsed.scheme != "https" or not parsed.hostname or \
       parsed.hostname != parsed.hostname.lower() or parsed.port is not None or \
       parsed.netloc != parsed.hostname or parsed.username or parsed.password or parsed.params or \
       parsed.query or parsed.fragment or not parsed.path.startswith("/") or \
       "%" in parsed.path or "//" in parsed.path or \
       any(segment in (".", "..") for segment in parsed.path.split("/")) or \
       (directory and not parsed.path.endswith("/")) or \
       (not directory and parsed.path.endswith("/")) or \
       (required_suffix is not None and not parsed.path.endswith(required_suffix)):
        fail(f"{label} is not a canonical HTTPS {'directory' if directory else 'resource'} URL")
    return parsed


def url_child(base_url: str, *segments: str) -> str:
    """Append already-canonical controller path segments without dot-segment normalization."""
    base = canonical_https_url(base_url, "controller base URL", directory=True)
    if not segments or any(
        not isinstance(segment, str) or segment in (".", "..") or
        re.fullmatch(r"[A-Za-z0-9._-]+", segment) is None
        for segment in segments
    ):
        fail("controller URL child has an invalid path segment")
    result = base_url + "/".join(quote(segment, safe="") for segment in segments)
    parsed = canonical_https_url(result, "derived controller URL", directory=False)
    if parsed.scheme != base.scheme or parsed.netloc != base.netloc or \
       not parsed.path.startswith(base.path):
        fail("derived controller URL escaped its authorized origin/prefix")
    return result


def release_hil_request_headers(manifest_url: str, firmware_base_url: str) -> dict[str, str]:
    """Build the only extra headers accepted by the pinned board transport."""
    canonical_https_url(
        manifest_url, "release-HIL manifest URL", directory=False,
        required_suffix="/manifest.json",
    )
    canonical_https_url(firmware_base_url, "release-HIL firmware base URL", directory=True)
    for label, value in (("manifest", manifest_url), ("firmware base", firmware_base_url)):
        if len(value.encode("ascii")) > HIL_FEED_URL_MAX_BYTES:
            fail(f"release-HIL {label} URL exceeds the firmware header bound")
    return {
        HIL_MANIFEST_HEADER: manifest_url,
        HIL_FIRMWARE_BASE_HEADER: firmware_base_url,
    }


def load_release_hil_policy(
    path: Path = RELEASE_HIL_POLICY_PATH, *, require_root_owner: bool = True,
) -> dict[str, Any]:
    raw = load_secure_json(path, "release-HIL root policy", require_root_owner=require_root_owner)
    if raw.get("schema_version") != 3:
        fail("release-HIL root policy must be schema_version 3")
    authorized = raw.get("authorized_lab")
    forbidden = raw.get("forbidden_production")
    fields = {
        "host", "mac", "bootstrap_version", "bootstrap_elf", "bootstrap_app_sha256",
        "bootstrap_manifest_url", "bootstrap_firmware_base_url", "manifest_url",
        "firmware_base_url", "feed_control_url", "feed_controller_id",
        "power_base_url", "power_controller_id", "power_outlet",
    }
    if not isinstance(authorized, dict) or set(authorized) != fields or not isinstance(forbidden, dict):
        fail("release-HIL root policy has an invalid authorized/forbidden shape")
    hosts = forbidden.get("hosts")
    macs = forbidden.get("macs")
    feed_controller_ids = forbidden.get("feed_controller_ids")
    power_endpoints = forbidden.get("power_endpoints")
    controller_pattern = r"[A-Za-z0-9._-]{8,128}"
    outlet_pattern = r"[A-Za-z0-9._-]{1,64}"
    if not isinstance(hosts, list) or not hosts or \
       not all(isinstance(item, str) and item == item.lower() and
               re.fullmatch(r"[a-z0-9.-]+", item) for item in hosts) or \
       not isinstance(macs, list) or not macs or \
       not all(isinstance(item, str) and re.fullmatch(r"(?:[0-9A-F]{2}:){5}[0-9A-F]{2}", item)
               for item in macs) or \
       not isinstance(feed_controller_ids, list) or not feed_controller_ids or \
       not all(isinstance(item, str) and re.fullmatch(controller_pattern, item)
               for item in feed_controller_ids) or \
       not isinstance(power_endpoints, list) or not power_endpoints or \
       not all(isinstance(item, dict) and set(item) == {"controller_id", "outlet"}
               and isinstance(item["controller_id"], str)
               and re.fullmatch(controller_pattern, item["controller_id"])
               and isinstance(item["outlet"], str)
               and item["outlet"] not in (".", "..")
               and re.fullmatch(outlet_pattern, item["outlet"])
               for item in power_endpoints):
        fail(
            "release-HIL root policy needs canonical non-empty production "
            "host/MAC/feed/power denylists"
        )
    if not isinstance(authorized["host"], str) or authorized["host"] != authorized["host"].lower() or \
       not re.fullmatch(r"[a-z0-9.-]+", authorized["host"]) or \
       not isinstance(authorized["mac"], str) or \
       not re.fullmatch(r"(?:[0-9A-F]{2}:){5}[0-9A-F]{2}", authorized["mac"]) or \
       not isinstance(authorized["bootstrap_version"], str) or \
       not re.fullmatch(r"[0-9A-Za-z.+-]{1,31}", authorized["bootstrap_version"]) or \
       not isinstance(authorized["bootstrap_elf"], str) or \
       not re.fullmatch(r"[0-9a-f]{9}", authorized["bootstrap_elf"]) or \
       not isinstance(authorized["bootstrap_app_sha256"], str) or \
       not re.fullmatch(r"[0-9a-f]{64}", authorized["bootstrap_app_sha256"]) or \
       not isinstance(authorized["feed_controller_id"], str) or \
       not re.fullmatch(controller_pattern, authorized["feed_controller_id"]) or \
       not isinstance(authorized["power_controller_id"], str) or \
       not re.fullmatch(controller_pattern, authorized["power_controller_id"]) or \
       not isinstance(authorized["power_outlet"], str) or \
       authorized["power_outlet"] in (".", "..") or \
       not re.fullmatch(outlet_pattern, authorized["power_outlet"]):
        fail("release-HIL root policy has invalid canonical host/controller identities")
    canonical_https_url(
        authorized["bootstrap_manifest_url"],
        "release-HIL root policy bootstrap_manifest_url", directory=False,
        required_suffix="/manifest.json",
    )
    canonical_https_url(
        authorized["bootstrap_firmware_base_url"],
        "release-HIL root policy bootstrap_firmware_base_url", directory=True,
    )
    canonical_https_url(
        authorized["manifest_url"], "release-HIL root policy manifest_url", directory=False,
        required_suffix="/manifest.json",
    )
    canonical_https_url(
        authorized["firmware_base_url"], "release-HIL root policy firmware_base_url",
        directory=True,
    )
    canonical_https_url(
        authorized["feed_control_url"], "release-HIL root policy feed_control_url",
        directory=True,
    )
    canonical_https_url(
        authorized["power_base_url"], "release-HIL root policy power_base_url",
        directory=True,
    )
    if authorized["bootstrap_manifest_url"] == authorized["manifest_url"] or \
       authorized["bootstrap_firmware_base_url"] == authorized["firmware_base_url"]:
        fail("release-HIL bootstrap and candidate feeds must be distinct")
    if authorized["host"] in hosts or authorized["mac"] in macs or \
       authorized["feed_controller_id"] in feed_controller_ids or \
       {"controller_id": authorized["power_controller_id"], "outlet": authorized["power_outlet"]} \
       in power_endpoints:
        fail("release-HIL authorized lab overlaps the independent production denylist")
    return authorized


def load_release_hil_inventory(
    path: Path = RELEASE_HIL_INVENTORY_PATH,
    *,
    policy_path: Path = RELEASE_HIL_POLICY_PATH,
    require_root_policy: bool = True,
) -> dict[str, Any]:
    """Load the isolated lab only when an independent root policy authorizes every endpoint."""
    raw = load_secure_json(path, "release-HIL inventory", require_root_owner=False)
    if not isinstance(raw, dict) or raw.get("schema_version") != 3:
        fail("release-HIL inventory must be a schema_version 3 object")
    lab = raw.get("lab")
    power = raw.get("power")
    if not isinstance(lab, dict) or not isinstance(power, dict):
        fail("release-HIL inventory requires lab and power objects")

    host = lab.get("host")
    mac = lab.get("mac")
    channel = lab.get("channel")
    if not isinstance(host, str) or host != host.lower() or \
       not re.fullmatch(r"[a-z0-9.-]+", host):
        fail("release-HIL lab.host is invalid")
    if not isinstance(mac, str) or not re.fullmatch(r"(?:[0-9A-F]{2}:){5}[0-9A-F]{2}", mac):
        fail("release-HIL lab.mac must be uppercase colon-separated hex")
    if channel != "release":
        fail("release-HIL lab.channel must be release")
    bootstrap_version = lab.get("bootstrap_version")
    bootstrap_elf = lab.get("bootstrap_elf")
    bootstrap_app_sha256 = lab.get("bootstrap_app_sha256")
    if not isinstance(bootstrap_version, str) or \
       not re.fullmatch(r"[0-9A-Za-z.+-]{1,31}", bootstrap_version) or \
       not isinstance(bootstrap_elf, str) or not re.fullmatch(r"[0-9a-f]{9}", bootstrap_elf) or \
       not isinstance(bootstrap_app_sha256, str) or \
       not re.fullmatch(r"[0-9a-f]{64}", bootstrap_app_sha256):
        fail("release-HIL bootstrap version/ELF/application identity is invalid")

    bootstrap_manifest_url = lab.get("bootstrap_manifest_url")
    parsed_bootstrap_manifest = canonical_https_url(
        bootstrap_manifest_url, "release-HIL lab.bootstrap_manifest_url", directory=False,
        required_suffix="/manifest.json",
    )
    bootstrap_firmware_base_url = lab.get("bootstrap_firmware_base_url")
    parsed_bootstrap_base = canonical_https_url(
        bootstrap_firmware_base_url, "release-HIL lab.bootstrap_firmware_base_url",
        directory=True,
    )

    manifest_url = lab.get("manifest_url")
    parsed_manifest = canonical_https_url(
        manifest_url, "release-HIL lab.manifest_url", directory=False,
        required_suffix="/manifest.json",
    )

    firmware_base_url = lab.get("firmware_base_url")
    parsed_firmware_base = canonical_https_url(
        firmware_base_url, "release-HIL lab.firmware_base_url", directory=True,
    )

    feed_control_url = lab.get("feed_control_url")
    feed_controller_id = lab.get("feed_controller_id")
    parsed_feed_control = canonical_https_url(
        feed_control_url, "release-HIL lab.feed_control_url", directory=True,
    )
    if not isinstance(feed_controller_id, str) or \
       not re.fullmatch(r"[A-Za-z0-9._-]{8,128}", feed_controller_id):
        fail("release-HIL lab.feed_controller_id is invalid")
    if parsed_feed_control.hostname == host or parsed_manifest.hostname == host or \
       parsed_firmware_base.hostname == host or parsed_bootstrap_manifest.hostname == host or \
       parsed_bootstrap_base.hostname == host:
        fail("release-HIL feed/controller and firmware host must be distinct")
    if bootstrap_manifest_url == manifest_url or \
       bootstrap_firmware_base_url == firmware_base_url:
        fail("release-HIL bootstrap and candidate feeds must be distinct")

    persistence_paths = lab.get("persistence_paths")
    persistence_canaries = lab.get("persistence_canaries")
    persistent_roots = {
        "board", "diagnostics", "env3", "hp", "modbus", "mqtt", "ntp", "ota",
        "profile", "syslog", "ui", "weather_forecast",
    }
    required_persistence = {
        "hp.rx", "hp.tx", "profile.id", "ota.channel", "mqtt.base", "mqtt.base_custom",
    }
    if not isinstance(persistence_paths, list) or \
       not all(isinstance(item, str) and re.fullmatch(r"[a-zA-Z0-9_]+(?:\.[a-zA-Z0-9_]+)+", item)
               and item.split(".", 1)[0] in persistent_roots for item in persistence_paths) or \
       not required_persistence.issubset(persistence_paths):
        fail(
            "release-HIL lab.persistence_paths must include hp.rx, hp.tx, profile.id, ota.channel, "
            "mqtt.base and mqtt.base_custom"
        )
    if not isinstance(persistence_canaries, dict) or \
       set(persistence_canaries) != {"mqtt.base", "mqtt.base_custom"} or \
       persistence_canaries.get("mqtt.base_custom") is not True:
        fail(
            "release-HIL lab.persistence_canaries must bind mqtt.base and mqtt.base_custom=true"
        )
    mqtt_canary = persistence_canaries.get("mqtt.base")
    if not isinstance(mqtt_canary, str) or not re.fullmatch(
        r"daikin-altherma-esp32/release-hil-canary-[0-9a-f]{16,64}", mqtt_canary,
    ):
        fail(
            "release-HIL mqtt.base canary must be an explicit non-default release-hil-canary value"
        )
    for flag in ("require_x10a", "require_weather"):
        if lab.get(flag) is not True:
            fail(f"release-HIL lab.{flag} must be true")
    stack_tasks = lab.get("required_stack_tasks")
    allowed_tasks = {"httpd", "poll", "mqtt", "modbus", "weather"}
    required_tasks = {"httpd", "poll", "mqtt"}
    if lab["require_weather"]:
        required_tasks.add("weather")
    if not isinstance(stack_tasks, list) or not required_tasks.issubset(stack_tasks) or \
       not set(stack_tasks).issubset(allowed_tasks):
        fail(
            "release-HIL required_stack_tasks must include httpd, poll, mqtt and every required "
            "optional stress task (weather)"
        )
    min_stack = lab.get("min_stack_free_bytes", 1024)
    if not isinstance(min_stack, int) or not 1024 <= min_stack <= 8192:
        fail("release-HIL min_stack_free_bytes must be 1024..8192")

    base_url = power.get("base_url")
    power_controller_id = power.get("controller_id")
    parsed_power = canonical_https_url(
        base_url, "release-HIL power.base_url", directory=True,
    )
    if not isinstance(power_controller_id, str) or \
       not re.fullmatch(r"[A-Za-z0-9._-]{8,128}", power_controller_id):
        fail("release-HIL power.controller_id is invalid")
    if parsed_power.hostname == host:
        fail("release-HIL power controller and firmware host must be distinct")
    outlet = power.get("outlet")
    if not isinstance(outlet, str) or outlet in (".", "..") or \
       not re.fullmatch(r"[A-Za-z0-9._-]{1,64}", outlet):
        fail("release-HIL power.outlet is invalid")

    authorized = load_release_hil_policy(
        policy_path, require_root_owner=require_root_policy,
    )
    binding = {
        "host": host,
        "mac": mac,
        "bootstrap_version": bootstrap_version,
        "bootstrap_elf": bootstrap_elf,
        "bootstrap_app_sha256": bootstrap_app_sha256,
        "bootstrap_manifest_url": bootstrap_manifest_url,
        "bootstrap_firmware_base_url": bootstrap_firmware_base_url,
        "manifest_url": manifest_url,
        "firmware_base_url": firmware_base_url,
        "feed_control_url": feed_control_url,
        "feed_controller_id": feed_controller_id,
        "power_base_url": base_url,
        "power_controller_id": power_controller_id,
        "power_outlet": outlet,
    }
    if binding != authorized:
        fail("release-HIL inventory endpoints are not the independently authorized lab identity")

    return {
        "host": host,
        "mac": mac,
        "bootstrap_version": bootstrap_version,
        "bootstrap_elf": bootstrap_elf,
        "bootstrap_app_sha256": bootstrap_app_sha256,
        "bootstrap_manifest_url": bootstrap_manifest_url,
        "bootstrap_firmware_base_url": bootstrap_firmware_base_url,
        "channel": channel,
        "manifest_url": manifest_url,
        "firmware_base_url": firmware_base_url,
        "feed_control_url": feed_control_url,
        "feed_controller_id": feed_controller_id,
        "persistence_paths": persistence_paths,
        "persistence_canaries": persistence_canaries,
        "required_stack_tasks": stack_tasks,
        "min_stack_free_bytes": min_stack,
        "require_x10a": lab["require_x10a"],
        "require_weather": lab["require_weather"],
        "power_base_url": base_url,
        "power_controller_id": power_controller_id,
        "power_outlet": outlet,
    }


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


def request_limited_bytes(
    url: str, label: str, max_bytes: int, *, timeout: float = HTTP_TIMEOUT_S,
) -> bytes:
    """Read a small remote document with a whole-operation deadline and fixed memory bound."""
    if max_bytes <= 0:
        fail(f"{label} limit is invalid")
    if timeout <= 0:
        fail(f"{label} deadline is invalid")
    completed = threading.Event()
    outcome: list[bytes | BaseException] = []

    def fetch() -> None:
        try:
            request = Request(url, headers={"User-Agent": "daikin-production-ota-gate/1"})
            with urlopen(request, timeout=timeout) as response:
                if response.status < 200 or response.status >= 300:
                    fail(f"GET {url} returned HTTP {response.status}")
                declared = response.headers.get("Content-Length")
                if declared is not None:
                    try:
                        declared_size = int(declared)
                    except ValueError:
                        fail(f"{label} has an invalid Content-Length")
                    if declared_size < 0 or declared_size > max_bytes:
                        fail(f"{label} exceeds the {max_bytes}-byte limit")
                payload = response.read(max_bytes + 1)
            if len(payload) > max_bytes:
                fail(f"{label} exceeds the {max_bytes}-byte limit")
            outcome.append(payload)
        except BaseException as error:
            outcome.append(error)
        finally:
            completed.set()

    # urllib's timeout is an inactivity timeout. The daemon boundary makes the public contract a
    # whole-operation deadline as well: a peer cannot keep this pre-device gate alive by trickling
    # one byte per socket timeout, and the bounded worker cannot grow host memory while it exits.
    threading.Thread(target=fetch, name="manifest-fetch", daemon=True).start()
    if not completed.wait(timeout):
        fail(f"{label} exceeded its {timeout:g}-second deadline")
    result = outcome[0]
    if isinstance(result, BaseException):
        raise result
    return result


def request_json(
    host: str, path: str, *, method: str = "GET", timeout: int = HTTP_TIMEOUT_S,
    payload: dict[str, Any] | None = None,
) -> dict[str, Any]:
    data = json.dumps(payload, separators=(",", ":")).encode() if payload is not None else None
    raw = request_bytes(
        f"http://{host}{path}", method=method, timeout=timeout, data=data,
        content_type="application/json" if payload is not None else None,
    )
    value = strict_json(raw, f"{host}{path} response")
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


def read_bounded_http_response(
    connection: socket.socket, host_header: str, path: str, deadline: float, *,
    max_body_bytes: int, allow_chunked: bool,
) -> bytes:
    """Read one bounded HTTP body while every receive consumes one absolute deadline."""
    if max_body_bytes <= 0:
        fail("HTTP response body bound must be positive")

    def apply_remaining_timeout() -> None:
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            raise TimeoutError("HTTP request exceeded its whole-request deadline")
        connection.settimeout(remaining)

    response = bytearray()
    while b"\r\n\r\n" not in response:
        apply_remaining_timeout()
        chunk = connection.recv(1024)
        if not chunk:
            raise CompactTransportError("HTTP response ended before its headers")
        response.extend(chunk)
        # Three bytes beyond the header bound can still begin the four-byte delimiter at the final
        # legal header byte. Once that is impossible, fail before accepting unbounded header data.
        if b"\r\n\r\n" not in response and len(response) > HTTP_HEADER_MAX_BYTES + 3:
            fail("HTTP response headers exceed their fixed bound")

    header_end = response.index(b"\r\n\r\n")
    if header_end > HTTP_HEADER_MAX_BYTES:
        fail("HTTP response headers exceed their fixed bound")
    raw_headers = bytes(response[:header_end])
    raw_body = bytearray(response[header_end + 4:])
    lines = raw_headers.split(b"\r\n")
    status_parts = lines[0].split(b" ", 2)
    if len(status_parts) < 2 or status_parts[0] != b"HTTP/1.1" or \
       not status_parts[1].isdigit():
        fail("HTTP response has an invalid status line")
    status = int(status_parts[1])
    content_lengths: list[bytes] = []
    transfer_encodings: list[bytes] = []
    for line in lines[1:]:
        if not line or line[:1] in (b" ", b"\t"):
            fail("HTTP response has an empty or folded header")
        name, separator, value = line.partition(b":")
        if not separator or re.fullmatch(rb"[!#$%&'*+\-.^_`|~0-9A-Za-z]+", name) is None:
            fail("HTTP response has a malformed header")
        normalized_name = name.lower()
        if normalized_name == b"content-length":
            content_lengths.append(value.strip())
        elif normalized_name == b"transfer-encoding":
            transfer_encodings.append(value.strip().lower())
    if transfer_encodings:
        if content_lengths or len(transfer_encodings) != 1 or \
           transfer_encodings[0] != b"chunked" or not allow_chunked:
            fail("HTTP response has unsupported or ambiguous transfer framing")

        encoded = raw_body
        body = bytearray()

        def receive_more(limit: int = 4096) -> None:
            apply_remaining_timeout()
            chunk = connection.recv(limit)
            if not chunk:
                raise CompactTransportError("chunked HTTP response ended before its terminator")
            encoded.extend(chunk)

        def read_chunk_line() -> bytes:
            while b"\r\n" not in encoded:
                if len(encoded) > HTTP_CHUNK_LINE_MAX_BYTES:
                    fail("chunked HTTP response has an oversized chunk line")
                receive_more(min(1024, HTTP_CHUNK_LINE_MAX_BYTES + 2 - len(encoded)))
            line_end = encoded.index(b"\r\n")
            if line_end == 0 or line_end > HTTP_CHUNK_LINE_MAX_BYTES:
                fail("chunked HTTP response has an invalid chunk line")
            line = bytes(encoded[:line_end])
            del encoded[:line_end + 2]
            return line

        def read_encoded_exact(size: int) -> bytes:
            while len(encoded) < size:
                receive_more(min(4096, size - len(encoded)))
            result = bytes(encoded[:size])
            del encoded[:size]
            return result

        while True:
            size_text = read_chunk_line()
            # Extensions and trailers are intentionally unsupported: neither is emitted by the
            # firmware, and rejecting them keeps the HIL evidence parser small and unambiguous.
            if re.fullmatch(rb"[0-9A-Fa-f]+", size_text) is None:
                fail("chunked HTTP response has an invalid chunk size")
            chunk_size = int(size_text, 16)
            if chunk_size == 0:
                if read_encoded_exact(2) != b"\r\n" or encoded:
                    fail("chunked HTTP response has trailers or bytes after its terminator")
                break
            if chunk_size > max_body_bytes - len(body):
                fail("chunked HTTP response body exceeds its fixed bound")
            body.extend(read_encoded_exact(chunk_size))
            if read_encoded_exact(2) != b"\r\n":
                fail("chunked HTTP response chunk lacks its terminator")
    else:
        if len(content_lengths) != 1 or not content_lengths[0].isdigit():
            fail("HTTP response needs one numeric Content-Length")
        content_length = int(content_lengths[0])
        if content_length > max_body_bytes or len(raw_body) > content_length:
            fail("HTTP response body exceeds its fixed bound")
        body = raw_body
        while len(body) < content_length:
            apply_remaining_timeout()
            chunk = connection.recv(min(4096, content_length - len(body)))
            if not chunk:
                raise CompactTransportError("HTTP response ended before its declared body")
            body.extend(chunk)

    apply_remaining_timeout()
    # Only classify an HTTP error after its complete framing passed the same strict bounds. This
    # prevents an ambiguous CL+TE or malformed chunked response from counting as an expected 503
    # busy witness in the HIL stress window.
    if status < 200 or status >= 300:
        raise HTTPError(
            f"http://{host_header}{path}", status,
            "HTTP request failed", None, None,
        )
    return bytes(body)


def read_bounded_json_response(
    connection: socket.socket, host_header: str, path: str, deadline: float, *,
    max_body_bytes: int, allow_chunked: bool,
) -> dict[str, Any]:
    body = read_bounded_http_response(
        connection, host_header, path, deadline,
        max_body_bytes=max_body_bytes, allow_chunked=allow_chunked,
    )
    try:
        value = strict_json(body, f"{host_header}{path} HTTP response")
    except GateError as error:
        raise GateError("HTTP response has malformed JSON") from error
    if not isinstance(value, dict):
        fail("HTTP response is not a JSON object")
    return value


def read_compact_json_response(
    connection: socket.socket, host_header: str, path: str, deadline: float,
) -> dict[str, Any]:
    """Read a small Content-Length JSON response under one whole-request deadline."""
    return read_bounded_json_response(
        connection, host_header, path, deadline,
        max_body_bytes=OTA_STATUS_MAX_BYTES, allow_chunked=False,
    )


def request_bytes_deadline(
    endpoint: ResolvedHttpEndpoint, path: str, *, timeout: float,
    max_body_bytes: int, allow_chunked: bool,
    method: str = "GET", payload: dict[str, Any] | None = None,
    extra_headers: dict[str, str] | None = None,
) -> bytes:
    """Use one resolved endpoint and read a bounded HTTP/1.1 body under one deadline."""
    if timeout <= 0 or method not in ("GET", "POST") or not path.startswith("/") or \
       any(c in path for c in "\r\n ") or (method == "GET" and payload is not None):
        fail("bounded HTTP request arguments are invalid")
    if extra_headers is not None:
        if method != "GET" or not path.startswith("/ota/check?") or \
           set(extra_headers) != HIL_FEED_HEADERS:
            fail("bounded HTTP extra headers are restricted to one complete HIL check pair")
        for name, value in extra_headers.items():
            if not isinstance(value, str) or not value.isascii() or \
               len(value.encode("ascii")) > HIL_FEED_URL_MAX_BYTES or \
               any(ord(char) <= 0x20 or ord(char) == 0x7f for char in value):
                fail(f"bounded HTTP header {name} is invalid")
    body = json.dumps(payload, separators=(",", ":")).encode() if payload is not None else b""
    deadline = time.monotonic() + timeout
    connection = socket.socket(endpoint.family, endpoint.socktype, endpoint.proto)

    def apply_remaining_timeout() -> None:
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            raise TimeoutError("HTTP request exceeded its whole-request deadline")
        connection.settimeout(remaining)

    try:
        apply_remaining_timeout()
        connection.connect(endpoint.sockaddr)
        headers = [
            f"{method} {path} HTTP/1.1\r\n",
            f"Host: {endpoint.host_header}\r\n",
            "User-Agent: daikin-production-ota-gate/1\r\n",
            "Accept: application/json\r\n",
        ]
        if extra_headers is not None:
            headers.extend(f"{name}: {extra_headers[name]}\r\n" for name in sorted(extra_headers))
        headers.append(f"Content-Length: {len(body)}\r\n")
        if payload is not None:
            headers.append("Content-Type: application/json\r\n")
        headers.append("Connection: close\r\n\r\n")
        request_headers = "".join(headers).encode("ascii")
        apply_remaining_timeout()
        connection.sendall(request_headers + body)
        return read_bounded_http_response(
            connection, endpoint.host_header, path, deadline,
            max_body_bytes=max_body_bytes, allow_chunked=allow_chunked,
        )
    finally:
        connection.close()


def request_json_deadline(
    endpoint: ResolvedHttpEndpoint, path: str, *, timeout: float,
    method: str = "GET", payload: dict[str, Any] | None = None,
    extra_headers: dict[str, str] | None = None,
) -> dict[str, Any]:
    """Read one compact Content-Length JSON response from an already-resolved endpoint."""
    raw = request_bytes_deadline(
        endpoint, path, timeout=timeout, max_body_bytes=OTA_STATUS_MAX_BYTES,
        allow_chunked=False, method=method, payload=payload, extra_headers=extra_headers,
    )
    value = strict_json(raw, f"{endpoint.host_header}{path} compact response")
    if not isinstance(value, dict):
        fail(f"{endpoint.host_header}{path} did not return a JSON object")
    return value


def request_status_deadline(
    endpoint: ResolvedHttpEndpoint, *, timeout: float,
) -> dict[str, Any]:
    raw = request_bytes_deadline(
        endpoint, "/status", timeout=timeout, max_body_bytes=STATUS_MAX_BYTES,
        allow_chunked=True,
    )
    value = strict_json(raw, f"{endpoint.host_header}/status response")
    if not isinstance(value, dict):
        fail(f"{endpoint.host_header}/status did not return a JSON object")
    return value


def request_values_deadline(
    endpoint: ResolvedHttpEndpoint, *, timeout: float,
) -> dict[str, Any]:
    raw = request_bytes_deadline(
        endpoint, "/values", timeout=timeout, max_body_bytes=VALUES_MAX_BYTES,
        allow_chunked=True,
    )
    value = strict_json(raw, f"{endpoint.host_header}/values response")
    if not isinstance(value, dict):
        fail(f"{endpoint.host_header}/values did not return a JSON object")
    return value


def request_diag_deadline(endpoint: ResolvedHttpEndpoint, *, timeout: float) -> bytes:
    return request_bytes_deadline(
        endpoint, "/diag", timeout=timeout, max_body_bytes=DIAG_MAX_BYTES,
        allow_chunked=True,
    )


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


def require_legacy_bench_restore_manifest(
    manifest_bytes: bytes, manifest: dict[str, Any],
) -> None:
    """Reject a dev feed that the supported release cannot consume on the return leg."""
    if len(manifest_bytes) > LEGACY_BENCH_RESTORE_MANIFEST_MAX_BYTES:
        fail(
            "official dev manifest exceeds the 1024-byte legacy bench restore limit; "
            "refusing before any board access"
        )
    if "artifacts" in manifest:
        fail("official dev manifest must keep its artifact inventory in artifacts.json")
    try:
        manifest_bytes.decode("ascii")
    except UnicodeDecodeError:
        fail("official dev manifest is not ASCII-compatible with the legacy bench parser")
    if b"\\" in manifest_bytes:
        fail("official dev manifest uses escapes rejected by the legacy bench parser")


def require_official_dev_manifest_snapshot(
    expected_manifest_sha256: str, expected_source_sha: str,
    expected_version: str, expected_app_sha256: str,
) -> None:
    """Rebind the mutable dev feed immediately before the bench release write."""
    manifest_bytes = request_limited_bytes(
        cache_busted(OFFICIAL_MANIFEST_URL), "official dev manifest rebind",
        LEGACY_BENCH_RESTORE_MANIFEST_MAX_BYTES,
    )
    if hashlib.sha256(manifest_bytes).hexdigest() != expected_manifest_sha256:
        fail("official dev manifest changed after initial validation")
    manifest = strict_json(manifest_bytes, "official dev manifest rebind")
    if not isinstance(manifest, dict):
        fail("official dev manifest rebind is not a JSON object")
    validate_manifest(
        OFFICIAL_MANIFEST_URL, manifest, expected_source_sha, expected_version,
        expected_app_sha256,
    )
    require_legacy_bench_restore_manifest(manifest_bytes, manifest)


def validate_release_manifest(
    manifest_url: str, manifest: dict[str, Any],
) -> tuple[str, str, str, str]:
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
    return version, app_sha256, urljoin(manifest_url, candidates[0]), source_sha


def require_release_source_binding(
    version: str, source_sha: str, app_sha256: str, tagged_source: str,
) -> None:
    """Bind future releases to their tag while narrowly adjudicating the historical 1.0.2 feed."""
    if source_sha == tagged_source:
        return
    if (version, source_sha, app_sha256) == (
        LEGACY_RELEASE_VERSION, LEGACY_RELEASE_SOURCE_SHA, LEGACY_RELEASE_APP_SHA256,
    ):
        return
    fail(
        f"official release provenance {source_sha} does not match "
        f"v{version} source {tagged_source}"
    )


def verify_release_source_binding(version: str, source_sha: str, app_sha256: str) -> None:
    tagged_source = run_checked(
        ["git", "rev-parse", f"v{version}^{{commit}}"], capture=True,
    ).strip()
    require_release_source_binding(version, source_sha, app_sha256, tagged_source)


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
    # Device status exposes the version and shortened ELF build id, not a full flash-image digest.
    # Callers separately verify the signed application bytes/SHA before delivery; this check proves
    # the expected build identity is running, not a cryptographic readback of every running byte.
    wifi = status.get("wifi", {})
    if str(wifi.get("mac", "")).upper() != mac:
        fail(f"{host} MAC does not match the pinned board identity")
    if status.get("version") != version or status.get("app_elf_sha256") != elf:
        fail(f"{host} is not running the expected firmware build {version}/{elf}")
    if not wifi.get("connected") or wifi.get("rolled_back"):
        fail(f"{host} is disconnected or reports rollback")
    sys_status = status.get("sys", {})
    crash = status.get("last_crash")
    if sys_status.get("safe_mode") or (isinstance(crash, dict) and crash.get("fault")):
        fail(f"{host} reports safe mode or a fault crash")


def board_counters(status: dict[str, Any]) -> dict[str, int]:
    system = status.get("sys", {})
    hp = status.get("hp", {})
    if not isinstance(system, dict) or not isinstance(hp, dict):
        fail("device status has no sys/hp counter objects")

    def required_counter(parent: dict[str, Any], name: str, section: str) -> int:
        value = parent.get(name)
        if isinstance(value, bool) or not isinstance(value, int) or value < 0:
            fail(f"device status has no valid non-negative {section}.{name} counter")
        return value

    return {
        "heap_restarts": required_counter(system, "heap_restarts", "sys"),
        "mqtt_skipped": required_counter(system, "mqtt_skipped", "sys"),
        "poll_skipped": required_counter(system, "poll_skipped", "sys"),
        "crc_err": required_counter(hp, "crc_err", "hp"),
        "timeout_err": required_counter(hp, "timeout_err", "hp"),
    }


def required_uptime(status: dict[str, Any], label: str) -> int:
    value = status.get("uptime_s")
    if isinstance(value, bool) or not isinstance(value, int) or value < 0:
        fail(f"{label} has no valid non-negative uptime_s")
    return value


def require_stress_ota_offer(
    status: dict[str, Any], *, version: str, app_sha256: str, channel: str,
    manifest_url: str | None = None, firmware_base_url: str | None = None,
) -> None:
    if status.get("state") != "idle" or status.get("available") != version or \
       status.get("available_sha256") != app_sha256 or \
       status.get("available_channel") != channel:
        fail("OTA manifest TLS did not finish on the exact expected artifact identity")
    if (manifest_url is None) != (firmware_base_url is None):
        fail("OTA offer feed expectation must be a complete pair")
    if manifest_url is not None and (
        status.get("effective_manifest_url") != manifest_url or
        status.get("effective_firmware_base_url") != firmware_base_url
    ):
        fail("OTA manifest TLS did not retain the exact effective HIL feed")


def request_weather_refresh(
    endpoint: ResolvedHttpEndpoint, host: str, status: dict[str, Any],
) -> tuple[int, int]:
    """Schedule one fresh weather TLS attempt without changing the saved configuration."""
    weather = status.get("weather_forecast")
    if not isinstance(weather, dict) or weather.get("configured") is not True:
        fail(f"{host} weather must be configured before its HIL refresh")
    if weather.get("fetching") is not False:
        fail(f"{host} weather must be idle before its HIL refresh")
    latitude = weather.get("latitude")
    longitude = weather.get("longitude")
    successes = weather.get("successes")
    if not isinstance(latitude, str) or not isinstance(longitude, str) or \
       isinstance(successes, bool) or not isinstance(successes, int) or successes < 0:
        fail(f"{host} weather status lacks unredacted coordinates or a valid success counter")
    result = request_json_deadline(
        endpoint, "/set_weather", method="POST", timeout=HTTP_TIMEOUT_S,
        payload={"latitude": latitude, "longitude": longitude, "refresh": True},
    )
    refresh_token = result.get("refresh_token") if isinstance(result, dict) else None
    if not isinstance(result, dict) or \
       result.get("ok") is not True or result.get("reboot") is not False or \
       result.get("saved") is not False or result.get("refresh_requested") is not True or \
       isinstance(refresh_token, bool) or not isinstance(refresh_token, int) or refresh_token <= 0:
        fail(f"{host} did not accept the non-persistent weather refresh trigger")
    return refresh_token, successes


def x10a_timeout_delta_exceeded(
    *, require_x10a: bool, baseline: dict[str, int], final: dict[str, int],
) -> bool:
    return require_x10a and final["timeout_err"] - baseline["timeout_err"] > MAX_X10A_TIMEOUT_DELTA


def stress_board(
    *, host: str, mac: str, version: str, elf: str, require_x10a: bool,
    require_weather: bool, expected_app_sha256: str, expected_channel: str,
    hil_manifest_url: str | None = None, hil_firmware_base_url: str | None = None,
) -> dict[str, Any]:
    if (hil_manifest_url is None) != (hil_firmware_base_url is None):
        fail("stress HIL feed expectation must be a complete pair")
    hil_headers = None if hil_manifest_url is None else release_hil_request_headers(
        hil_manifest_url, hil_firmware_base_url,
    )
    pinned_endpoint = resolve_http_endpoint(host)
    started = request_status_deadline(pinned_endpoint, timeout=HTTP_TIMEOUT_S)
    validate_identity(started, host=host, mac=mac, version=version, elf=elf)
    if require_weather:
        # A notification posted during an ordinary fetch is consumed only after that fetch and
        # schedules another one. Do not let the first success edge masquerade as the explicit HIL
        # refresh or clear the 503 allowance while the notified fetch is still pending.
        idle_deadline = time.monotonic() + OTA_CHECK_TIMEOUT_S
        while True:
            weather_state = started.get("weather_forecast")
            fetching = weather_state.get("fetching") if isinstance(weather_state, dict) else None
            if fetching is False and started.get("mqtt", {}).get("connected") is True:
                break
            if not isinstance(fetching, bool):
                fail(f"{host} weather status has no boolean fetching state")
            if time.monotonic() >= idle_deadline:
                fail(f"{host} weather did not become idle before its HIL refresh")
            time.sleep(0.1)
            try:
                started = request_status_deadline(pinned_endpoint, timeout=1)
            except HTTPError as error:
                if error.code != 503:
                    raise
                continue
            except (CompactTransportError, OSError, TimeoutError):
                continue
            validate_identity(started, host=host, mac=mac, version=version, elf=elf)
    if not started.get("mqtt", {}).get("connected"):
        fail(f"{host} MQTT must be connected before the pressure window")
    started_uptime = required_uptime(started, f"{host} initial stress status")
    if started_uptime > MAX_TEST_START_UPTIME_S:
        fail(f"{host} must enter the pressure gate within {MAX_TEST_START_UPTIME_S}s of boot")
    baseline = board_counters(started)
    weather_before = started.get("weather_forecast", {})
    if require_weather and not isinstance(weather_before, dict):
        fail(f"{host} weather status is not an object")
    deadline = time.monotonic() + STRESS_SECONDS
    lock = threading.Lock()
    samples: dict[str, int] = {"status": 0, "values": 0, "diag": 0}
    busy_503: dict[str, int] = {"status": 0, "values": 0}
    errors: list[str] = []
    uptimes: list[int] = [started_uptime]
    disconnected = 0
    scheduled_tls_active = threading.Event()
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
                status = request_status_deadline(
                    pinned_endpoint, timeout=HTTP_TIMEOUT_S,
                )
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
                    uptimes.append(required_uptime(status, f"{host} sampled stress status"))
            except HTTPError as error:
                if error.code == 503 and scheduled_tls_active.is_set():
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
                if kind == "values":
                    request_values_deadline(pinned_endpoint, timeout=HTTP_TIMEOUT_S)
                else:
                    raw = request_diag_deadline(pinned_endpoint, timeout=HTTP_TIMEOUT_S)
                if kind == "diag" and not raw:
                    fail("empty diagnostic response")
                with lock:
                    samples[kind] += 1
            except HTTPError as error:
                if kind == "values" and error.code == 503 and scheduled_tls_active.is_set():
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
    # Schedule a same-value, non-persistent weather refresh before the OTA manifest check while all
    # three probes are already active. The firmware serializes these two constrained TLS owners; the
    # bounded window therefore exercises both real clients under the same HTTP/MQTT/X10A pressure
    # without relying on the ordinary 45-minute weather cadence or rewriting NVS.
    scheduled_tls_active.set()
    mqtt_recovery_expected.set()
    weather_refresh_token = None
    weather_successes_before = None
    if require_weather:
        weather_refresh_token, weather_successes_before = request_weather_refresh(
            pinned_endpoint, host, started,
        )
    accepted = request_json_deadline(
        pinned_endpoint, f"/ota/check?ms={int(time.time() * 1000)}", timeout=HTTP_TIMEOUT_S,
        extra_headers=hil_headers,
    )
    generation = accepted.get("generation")
    if accepted.get("ok") is not True or not isinstance(generation, int) or generation <= 0:
        fail(f"{host} pressure check did not return an accepted OTA generation")
    check_deadline = time.monotonic() + OTA_CHECK_TIMEOUT_S
    ota_check: dict[str, Any] = {}
    while time.monotonic() < check_deadline:
        ota_check = request_json_deadline(
            pinned_endpoint, "/ota/status", timeout=HTTP_TIMEOUT_S,
        )
        if ota_check.get("generation") != generation:
            fail(f"{host} pressure check generation changed")
        if ota_check.get("busy") is False:
            break
        time.sleep(OTA_OFFER_POLL_SECONDS)
    else:
        fail(f"{host} OTA manifest TLS did not release its busy claim")
    weather_refresh_status: dict[str, Any] | None = None
    if require_weather:
        weather_deadline = min(deadline, time.monotonic() + OTA_CHECK_TIMEOUT_S)
        while time.monotonic() < weather_deadline:
            try:
                candidate = request_status_deadline(pinned_endpoint, timeout=1)
            except HTTPError as error:
                if error.code != 503:
                    raise
                time.sleep(0.1)
                continue
            except (CompactTransportError, OSError, TimeoutError):
                time.sleep(0.1)
                continue
            validate_identity(candidate, host=host, mac=mac, version=version, elf=elf)
            weather_candidate = candidate.get("weather_forecast", {})
            if isinstance(weather_candidate, dict):
                refresh_fields = {
                    key: weather_candidate.get(key)
                    for key in (
                        "refresh_requested_token", "refresh_started_token",
                        "refresh_completed_token", "refresh_success_token",
                    )
                }
                if any(isinstance(value, bool) or not isinstance(value, int) or value < 0
                       for value in refresh_fields.values()):
                    fail(f"{host} weather status has malformed refresh-token evidence")
                if refresh_fields["refresh_completed_token"] == weather_refresh_token:
                    if refresh_fields["refresh_requested_token"] != weather_refresh_token or \
                       refresh_fields["refresh_started_token"] != weather_refresh_token or \
                       refresh_fields["refresh_success_token"] != weather_refresh_token:
                        fail(f"{host} explicitly triggered weather TLS refresh failed")
                    successes_after = weather_candidate.get("successes")
                    if isinstance(successes_after, bool) or not isinstance(successes_after, int) or \
                       successes_after <= weather_successes_before or \
                       weather_candidate.get("fetching") is not False:
                        fail(f"{host} weather refresh token completed without its success commit")
                    weather_refresh_status = weather_candidate
                    break
            time.sleep(0.1)
        if weather_refresh_status is None:
            fail(f"{host} did not complete the explicitly triggered weather TLS refresh")
    # Each constrained network owner destroys its active flag before publishing final state. Keep
    # the 503 allowance for one scheduler turn after both exact completion observations.
    time.sleep(0.25)
    scheduled_tls_active.clear()
    mqtt_recovery_deadline = time.monotonic() + MQTT_RECOVERY_TIMEOUT_S
    mqtt_recovery_error = "still disconnected"
    while time.monotonic() < mqtt_recovery_deadline:
        try:
            mqtt_recovery_status = request_status_deadline(pinned_endpoint, timeout=1)
        except (CompactTransportError, OSError, TimeoutError) as error:
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

    finished = request_status_deadline(pinned_endpoint, timeout=HTTP_TIMEOUT_S)
    validate_identity(finished, host=host, mac=mac, version=version, elf=elf)
    uptimes.append(required_uptime(finished, f"{host} final stress status"))
    require_stress_ota_offer(
        ota_check, version=version, app_sha256=expected_app_sha256,
        channel=expected_channel, manifest_url=hil_manifest_url,
        firmware_base_url=hil_firmware_base_url,
    )
    if not finished.get("mqtt", {}).get("connected"):
        fail(f"{host} MQTT was not connected after the pressure window")
    final = board_counters(finished)
    if errors:
        fail(f"{host} live stress had errors: {'; '.join(errors)}")
    if samples["status"] < MIN_STATUS_SAMPLES or samples["values"] < MIN_VALUES_SAMPLES or samples["diag"] < MIN_DIAG_SAMPLES:
        fail(f"{host} live stress produced too few successful samples: {samples}")
    if busy_503["status"] <= 0 or busy_503["values"] <= 0:
        fail(f"{host} did not prove fast status/values refusal during scheduled TLS: {busy_503}")
    if any(later < earlier for earlier, later in zip(uptimes, uptimes[1:])):
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
        if weather_successes_before is None or \
           int(weather.get("successes", 0)) <= weather_successes_before:
            fail(f"{host} completed no new weather TLS fetch inside the live stress window")
        if weather_refresh_token is None or \
           weather.get("refresh_requested_token") != weather_refresh_token or \
           weather.get("refresh_started_token") != weather_refresh_token or \
           weather.get("refresh_completed_token") != weather_refresh_token or \
           weather.get("refresh_success_token") != weather_refresh_token:
            fail(f"{host} final status lost the exact Weather refresh witness")
    return {
        "samples": samples,
        "tls_busy_503": busy_503,
        "uptime": [uptimes[0], uptimes[-1]],
        "counters_before": baseline,
        "counters_after": final,
        "free_heap": int(system.get("free_heap", 0)),
        "largest_block": int(system.get("max_alloc", 0)),
        "ota_check": {"state": ota_check.get("state"), "available": ota_check.get("available")},
        "weather_refresh": None if weather_refresh_status is None else {
            "token": weather_refresh_token,
            "successes_before": weather_successes_before,
            "successes_after": weather_refresh_status.get("successes"),
            "fetched_at": weather_refresh_status.get("fetched_at"),
        },
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
            parsed = strict_json(payload, "retained X10A MQTT payload")
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
    allow_downgrade: bool = False, expected_manifest_url: str | None = None,
    expected_firmware_base_url: str | None = None,
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
    if (expected_manifest_url is None) != (expected_firmware_base_url is None):
        fail("OTA offer feed expectation must be a complete pair")
    if expected_manifest_url is not None and (
        status.get("effective_manifest_url") != expected_manifest_url or
        status.get("effective_firmware_base_url") != expected_firmware_base_url
    ):
        fail("board did not bind the exact HIL feed to the accepted offer generation")
    return True


def wait_for_ota_offer(
    endpoint: ResolvedHttpEndpoint, expected_version: str, expected_app_sha256: str,
    *, expected_channel: str = "dev", allow_downgrade: bool = False,
    hil_manifest_url: str | None = None, hil_firmware_base_url: str | None = None,
) -> int:
    if (hil_manifest_url is None) != (hil_firmware_base_url is None):
        fail("OTA HIL feed override must be a complete pair")
    hil_headers = None if hil_manifest_url is None else release_hil_request_headers(
        hil_manifest_url, hil_firmware_base_url,
    )
    try:
        accepted = request_json_deadline(
            endpoint, f"/ota/check?ms={int(time.time() * 1000)}", timeout=HTTP_TIMEOUT_S,
            extra_headers=hil_headers,
        )
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
        status = request_json_deadline(endpoint, "/ota/status", timeout=HTTP_TIMEOUT_S)
        if ota_offer_ready(
            status, expected_version, expected_app_sha256, generation,
            expected_channel, allow_downgrade, hil_manifest_url, hil_firmware_base_url,
        ):
            return generation
        time.sleep(OTA_OFFER_POLL_SECONDS)
    fail(f"OTA check did not settle on the exact gated artifact within {OTA_CHECK_TIMEOUT_S} seconds")


def post_update_once(
    endpoint: ResolvedHttpEndpoint, check_generation: int,
    expected_version: str, expected_app_sha256: str,
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
        accepted = request_json_deadline(
            endpoint, f"/ota/update?{query}", method="POST", timeout=HTTP_TIMEOUT_S,
        )
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
                    ("ota_stack_min_free_bytes", "ota_stack_min_free_bytes"),
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
                status = request_status_deadline(
                    status_endpoint, timeout=OTA_STATUS_REQUEST_TIMEOUT_S,
                )
                if status.get("version") == version and status.get("app_elf_sha256") == elf:
                    return status
        except HTTPError as error:
            if error.code != 503:
                raise
        except (CompactTransportError, OSError, TimeoutError):
            pass  # expected only while the one accepted update reboots; never retried as a write
        time.sleep(OTA_STATUS_POLL_SECONDS)
    fail(f"board did not return on {version}/{elf}; OTA done observed={saw_done}")


def wait_for_bench_health_window(
    host: str, mac: str, version: str, elf: str, *, phase: str,
) -> dict[str, Any]:
    """Require one exact bench image to remain healthy beyond the rollback commit window.

    ESP-IDF forbids writing the other OTA slot while the running image is still PENDING_VERIFY.
    The bench deliberately has no X10A, so its normal connected/heap/no-allocation-failure proof
    commits at the 90-second base window after an OTA boot.  A USB-installed target is not rollback
    armed, but receives the same conservative 105-second health dwell. Current firmware also
    exposes a boot-latched compact image state; this ordinary bench path remains compatible with the
    older stable image used in its rollback exercise, so the following real OTA start remains the
    cross-version authoritative proof that an OTA-installed image did not stay unconfirmed.
    """
    if phase not in ("target", "release"):
        fail(f"invalid bench health-window phase {phase}")
    deadline = time.monotonic() + BENCH_HEALTH_WINDOW_TIMEOUT_S
    while time.monotonic() < deadline:
        endpoint = resolve_http_endpoint(host)
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            break
        status = request_status_deadline(
            endpoint, timeout=min(remaining, HTTP_TIMEOUT_S),
        )
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


def wait_for_legacy_offer(endpoint: ResolvedHttpEndpoint, expected_version: str) -> None:
    deadline = time.monotonic() + OTA_CHECK_TIMEOUT_S
    stable_since: float | None = None
    while time.monotonic() < deadline:
        status = request_json_deadline(endpoint, "/ota/status", timeout=HTTP_TIMEOUT_S)
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


def record_bench_pressure_failure(
    kind: str, error: BaseException, counts: dict[str, int], unexpected: list[str],
    lock: threading.Lock,
) -> None:
    """Keep every worker failure visible to the joining thread; no parser exception may vanish."""
    with lock:
        if isinstance(error, HTTPError) and kind in ("status", "values") and error.code == 503:
            counts[f"{kind}_busy_503"] = counts.get(f"{kind}_busy_503", 0) + 1
        elif isinstance(error, (CompactTransportError, OSError, TimeoutError)):
            counts[f"{kind}_reboot_gap"] = counts.get(f"{kind}_reboot_gap", 0) + 1
        elif len(unexpected) < 20:
            unexpected.append(f"{kind}: {error}")


def exercise_bench_full_download(
    *, host: str, mac: str, target_source_sha: str, target_version: str,
    target_sha256: str, target_manifest_sha256: str, target_elf: str,
    release_version: str, release_sha256: str, release_elf: str,
) -> dict[str, Any]:
    """Make the target firmware itself perform one complete signed binary TLS transfer.

    The exact target first binds one check generation to the official release feed without changing
    its configured dev channel, then installs that older signed build under concurrent HTTP pressure.
    The release restores through that configured official dev feed. This happens only on the
    private-inventory bench role and closes the old manifest-only gap.
    """
    if release_version == target_version:
        fail("bench full-download exercise needs a release distinct from the target")
    status_endpoint = resolve_http_endpoint(host)
    pinned_before = request_status_deadline(status_endpoint, timeout=HTTP_TIMEOUT_S)
    validate_identity(
        pinned_before, host=host, mac=mac, version=target_version, elf=target_elf,
    )
    require_official_dev_manifest_snapshot(
        target_manifest_sha256, target_source_sha, target_version, target_sha256,
    )
    # The current target supports one non-persistent feed binding on /ota/check. Use it for the
    # release leg so the configured channel remains dev even if a later pre-write check fails, and
    # so the checked release URL survives unchanged through its exact update generation.
    generation = wait_for_ota_offer(
        status_endpoint, release_version, release_sha256,
        expected_channel="dev", allow_downgrade=True,
        hil_manifest_url=OFFICIAL_RELEASE_MANIFEST_URL,
        hil_firmware_base_url=OFFICIAL_RELEASE_FIRMWARE_BASE_URL,
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
                if kind == "status":
                    request_status_deadline(status_endpoint, timeout=HTTP_TIMEOUT_S)
                elif kind == "values":
                    request_values_deadline(status_endpoint, timeout=HTTP_TIMEOUT_S)
                elif kind == "ota_status":
                    request_json_deadline(
                        status_endpoint, "/ota/status", timeout=HTTP_TIMEOUT_S,
                    )
                else:
                    raw = request_diag_deadline(status_endpoint, timeout=HTTP_TIMEOUT_S)
                if kind == "diag" and not raw:
                    fail("empty diagnostic response during bench binary pressure")
                bump(f"{kind}_ok")
            except BaseException as error:
                # A short transport disconnect is mandatory when the signed release boots. Parser,
                # framing and every other failure must survive the thread boundary as hard evidence.
                record_bench_pressure_failure(kind, error, counts, unexpected, lock)
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
        require_official_dev_manifest_snapshot(
            target_manifest_sha256, target_source_sha, target_version, target_sha256,
        )
        post_update_once(
            status_endpoint, generation, release_version, release_sha256,
            expected_channel="dev", allow_downgrade=True,
        )
        release_status = wait_for_new_firmware(
            host, release_version, release_elf, status_endpoint, target_transfer,
        )
    finally:
        stop.set()
        for worker in workers:
            worker.join(HTTP_TIMEOUT_S + 2)
            if worker.is_alive():
                unexpected.append(f"{worker.name}: pressure worker did not stop")

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
    # The health dwell reads by hostname. Revalidate the original resolved endpoint immediately
    # before its next write so a DHCP move plus old-address reuse cannot redirect the restore.
    pinned_release = request_status_deadline(status_endpoint, timeout=HTTP_TIMEOUT_S)
    validate_identity(
        pinned_release, host=host, mac=mac, version=release_version, elf=release_elf,
    )
    accepted = request_json_deadline(
        status_endpoint, f"/ota/check?ms={int(time.time() * 1000)}", timeout=HTTP_TIMEOUT_S,
    )
    restore_generation = accepted.get("generation")
    if isinstance(restore_generation, int) and restore_generation > 0:
        deadline = time.monotonic() + OTA_CHECK_TIMEOUT_S
        while time.monotonic() < deadline:
            status = request_json_deadline(
                status_endpoint, "/ota/status", timeout=HTTP_TIMEOUT_S,
            )
            if ota_offer_ready(
                status, target_version, target_sha256, restore_generation, "dev", False,
            ):
                break
            time.sleep(OTA_OFFER_POLL_SECONDS)
        else:
            fail("bench return check did not settle on the exact dev artifact")
        post_update_once(status_endpoint, restore_generation, target_version, target_sha256)
    else:
        if accepted.get("ok") is not True:
            fail("legacy bench firmware refused the dev return check")
        wait_for_legacy_offer(status_endpoint, target_version)
        # Exactly one un-retried BENCH restore write; production never uses this legacy endpoint.
        restored = request_json_deadline(
            status_endpoint, "/ota/update", method="POST", timeout=HTTP_TIMEOUT_S,
        )
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


def require_ota_transfer_evidence(
    host: str, evidence: dict[str, Any], *, phase: str,
    writer_version: str, writer_elf: str,
) -> None:
    """Require completed validation plus operation-local heap and OTA-task stack minima."""
    if int(evidence.get("heap_min_free_bytes", 0)) <= 0 or \
       int(evidence.get("heap_min_largest_block_bytes", 0)) <= 0:
        fail(f"{host} {phase} OTA did not expose sampled operation-local heap minima")
    if evidence.get("saw_done") is not True:
        fail(f"{host} {phase} OTA never exposed its completed validation state")
    ota_stack = evidence.get("ota_stack_min_free_bytes")
    legacy_writer_without_stack = phase == "bench target" and ota_stack is None and (
        writer_version, writer_elf,
    ) == (
        LEGACY_RELEASE_VERSION, LEGACY_RELEASE_ELF_ID,
    )
    if (not isinstance(ota_stack, int) or ota_stack < 1024) and \
       not legacy_writer_without_stack:
        fail(
            f"{host} {phase} OTA task stack headroom {ota_stack!r} is below 1024 bytes"
        )


def install_bench_target(
    *, host: str, mac: str, current_version: str, target_version: str,
    target_sha256: str, target_elf: str,
) -> dict[str, Any]:
    """Install exactly one signed dev artifact on the inventory-pinned bench role.

    This function has no production-board argument by construction. It owns one un-retried update
    write, then all remaining acceptance is read-only.
    """
    status_endpoint = resolve_http_endpoint(host)
    before = request_status_deadline(status_endpoint, timeout=HTTP_TIMEOUT_S)
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

    check_generation = wait_for_ota_offer(status_endpoint, target_version, target_sha256)
    update_generation = post_update_once(
        status_endpoint, check_generation, target_version, target_sha256,
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
    require_ota_transfer_evidence(
        host, transfer, phase="bench target",
        writer_version=current_version, writer_elf=current_elf,
    )
    health_window = wait_for_bench_health_window(
        host, mac, target_version, target_elf, phase="target",
    )
    stress = stress_board(
        host=host, mac=mac, version=target_version, elf=target_elf,
        require_x10a=False, require_weather=False,
        expected_app_sha256=target_sha256, expected_channel="dev",
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


def verify_release_hil_source(expected_source_sha: str) -> None:
    if not re.fullmatch(r"[0-9a-f]{40}", expected_source_sha):
        fail("release-HIL source SHA must be lowercase 40-hex")
    head = run_checked(["git", "rev-parse", "HEAD"], capture=True).strip()
    if head != expected_source_sha:
        fail(f"release-HIL checkout {head} is not artifact source {expected_source_sha}")
    result = subprocess.run(
        ["git", "status", "--porcelain=v1", "--untracked-files=all", "--ignored=matching"],
        cwd=ROOT, check=False, text=True, capture_output=True,
    )
    if result.returncode != 0 or result.stdout:
        fail("release-HIL checkout must contain no tracked, untracked or ignored workspace files")


def status_path(status: dict[str, Any], path: str) -> Any:
    value: Any = status
    for segment in path.split("."):
        if not isinstance(value, dict) or segment not in value:
            fail(f"release-HIL status does not expose persistent field {path}")
        value = value[segment]
    if isinstance(value, (dict, list)):
        fail(f"release-HIL persistent field {path} must be scalar")
    return value


def persistence_snapshot(
    status: dict[str, Any], paths: list[str], canaries: dict[str, Any],
) -> dict[str, Any]:
    snapshot = {path: status_path(status, path) for path in paths}
    for path, expected in canaries.items():
        if snapshot.get(path) != expected:
            fail(
                f"release-HIL persistence canary {path} is {snapshot.get(path)!r}, "
                f"expected {expected!r}"
            )
    return snapshot


def require_stack_evidence(status: dict[str, Any], tasks: list[str], minimum: int) -> dict[str, int]:
    stack = status.get("sys", {}).get("stack_min_free_bytes")
    if not isinstance(stack, dict):
        fail("release-HIL status has no stack_min_free_bytes evidence")
    evidence: dict[str, int] = {}
    for task in tasks:
        value = stack.get(task)
        if not isinstance(value, int) or value < minimum:
            fail(f"release-HIL {task} stack headroom {value!r} is below {minimum} bytes")
        evidence[task] = value
    return evidence


class NoRedirect(HTTPRedirectHandler):
    """Fail closed instead of forwarding a release-HIL request or bearer token."""

    def redirect_request(self, req, fp, code, msg, headers, newurl):  # noqa: ANN001
        return None


NO_REDIRECT_OPENER = build_opener(NoRedirect)


def control_json(
    url: str, *, method: str, token: str, payload: dict[str, Any] | None, label: str,
) -> dict[str, Any]:
    if not isinstance(token, str) or \
       re.fullmatch(r"[A-Za-z0-9._~+/=-]{1,4096}", token) is None:
        fail(f"{label} bearer token is missing or invalid")
    if method not in ("GET", "POST", "DELETE"):
        fail(f"{label} has an invalid controller method")
    if method == "GET" and payload is not None:
        fail(f"{label} GET request must not have a payload")
    if method != "GET" and not isinstance(payload, dict):
        fail(f"{label} mutating request must have an object payload")
    parsed = canonical_https_url(url, label, directory=False)
    request_body = json.dumps(payload, separators=(",", ":")).encode() \
        if payload is not None else b""
    deadline = time.monotonic() + HTTP_TIMEOUT_S
    raw_socket: socket.socket | None = None
    tls_socket: ssl.SSLSocket | None = None

    def remaining() -> float:
        value = deadline - time.monotonic()
        if value <= 0:
            raise TimeoutError(f"{label} exceeded its whole-response deadline")
        return value

    try:
        resolved: list[tuple[Any, ...]] = []
        resolution_errors: list[BaseException] = []
        resolution_done = threading.Event()

        def resolve_controller() -> None:
            try:
                resolved.extend(socket.getaddrinfo(
                    parsed.hostname, 443, type=socket.SOCK_STREAM,
                ))
            except BaseException as error:
                resolution_errors.append(error)
            finally:
                resolution_done.set()

        threading.Thread(target=resolve_controller, daemon=True).start()
        if not resolution_done.wait(remaining()):
            raise TimeoutError(f"{label} DNS resolution exceeded its whole-response deadline")
        if resolution_errors:
            raise OSError(f"controller DNS resolution failed: {resolution_errors[0]}")
        if not resolved:
            raise OSError("controller DNS resolution returned no stream endpoint")

        last_connect_error: OSError | None = None
        for family, socktype, proto, _canonname, sockaddr in resolved:
            candidate = socket.socket(family, socktype, proto)
            try:
                candidate.settimeout(remaining())
                candidate.connect(sockaddr)
                raw_socket = candidate
                break
            except OSError as error:
                last_connect_error = error
                candidate.close()
        if raw_socket is None:
            raise OSError(f"controller TCP connection failed: {last_connect_error}")

        raw_socket.settimeout(remaining())
        tls_socket = ssl.create_default_context().wrap_socket(
            raw_socket, server_hostname=parsed.hostname, do_handshake_on_connect=False,
        )
        tls_socket.settimeout(remaining())
        tls_socket.do_handshake()
        tls_socket.settimeout(remaining())
        request_headers = [
            f"{method} {parsed.path} HTTP/1.1\r\n"
            f"Host: {parsed.hostname}\r\n"
            "User-Agent: daikin-release-hil-gate/1\r\n"
            "Accept: application/json\r\n"
            f"Authorization: Bearer {token}\r\n"
        ]
        if method != "GET":
            request_headers.extend([
                "Content-Type: application/json\r\n",
                f"Content-Length: {len(request_body)}\r\n",
            ])
        request_headers.append("Connection: close\r\n\r\n")
        tls_socket.sendall("".join(request_headers).encode("ascii") + request_body)
        raw = read_bounded_http_response(
            tls_socket, parsed.hostname, parsed.path, deadline,
            max_body_bytes=CONTROL_RESPONSE_MAX_BYTES, allow_chunked=True,
        )
    except (OSError, TimeoutError, HTTPError, GateError) as error:
        fail(f"{label} request failed: {error}")
    finally:
        if tls_socket is not None:
            tls_socket.close()
        elif raw_socket is not None:
            raw_socket.close()
    result = strict_json(raw, f"{label} response")
    if not isinstance(result, dict):
        fail(f"{label} response is not an object")
    return result


def validate_feed_lease(
    result: dict[str, Any], *, controller_id: str, expected_id: str | None, active: bool,
    manifest_url: str, firmware_base_url: str,
) -> str:
    lease_id = result.get("lease_id")
    if result.get("controller_id") != controller_id or \
       not isinstance(lease_id, str) or not re.fullmatch(r"[A-Za-z0-9._-]{16,128}", lease_id) or \
       (expected_id is not None and lease_id != expected_id) or result.get("active") is not active or \
       result.get("manifest_url") != manifest_url or \
       result.get("firmware_base_url") != firmware_base_url or \
       (active and result.get("ttl_s") != FEED_LEASE_TTL_S):
        fail("release-HIL feed controller returned an invalid lease acknowledgement")
    return lease_id


@contextmanager
def leased_release_hil_feed(
    control_url: str, controller_id: str, manifest_url: str, firmware_base_url: str,
    manifest: bytes, app: bytes, token: str,
):
    """Activate a renewable private-feed lease that expires even if the runner is killed."""
    expected_hashes = {
        "manifest.json": hashlib.sha256(manifest).hexdigest(),
        "daikin-altherma-esp32.bin": hashlib.sha256(app).hexdigest(),
    }
    created = control_json(
        url_child(control_url, "leases"), method="POST", token=token,
        payload={
            "controller_id": controller_id,
            "ttl_s": FEED_LEASE_TTL_S,
            "manifest_url": manifest_url,
            "firmware_base_url": firmware_base_url,
            "files": {
                "manifest.json": base64.b64encode(manifest).decode("ascii"),
                "daikin-altherma-esp32.bin": base64.b64encode(app).decode("ascii"),
            },
        },
        label="release-HIL feed lease create",
    )
    lease_id = validate_feed_lease(
        created, controller_id=controller_id, expected_id=None, active=True,
        manifest_url=manifest_url, firmware_base_url=firmware_base_url,
    )
    if created.get("sha256") != expected_hashes:
        fail("release-HIL feed controller did not bind the exact candidate digests")

    stop = threading.Event()
    renewal_errors: list[BaseException] = []

    def renew() -> None:
        while not stop.wait(FEED_LEASE_RENEW_S):
            try:
                renewed = control_json(
                    url_child(control_url, "leases", lease_id, "renew"),
                    method="POST", token=token,
                    payload={
                        "controller_id": controller_id, "ttl_s": FEED_LEASE_TTL_S,
                        "manifest_url": manifest_url,
                        "firmware_base_url": firmware_base_url,
                    },
                    label="release-HIL feed lease renew",
                )
                validate_feed_lease(
                    renewed, controller_id=controller_id, expected_id=lease_id, active=True,
                    manifest_url=manifest_url, firmware_base_url=firmware_base_url,
                )
            except BaseException as error:
                renewal_errors.append(error)
                stop.set()

    worker = threading.Thread(target=renew, daemon=True)
    worker.start()

    def require_active() -> None:
        if renewal_errors:
            fail(f"release-HIL feed lease renewal failed: {renewal_errors[0]}")

    primary: BaseException | None = None
    try:
        yield require_active
        require_active()
    except BaseException as error:
        primary = error
        raise
    finally:
        stop.set()
        worker.join(FEED_LEASE_RENEW_S + HTTP_TIMEOUT_S)
        cleanup_error: BaseException | None = None
        try:
            retired = control_json(
                url_child(control_url, "leases", lease_id),
                method="DELETE", token=token,
                payload={
                    "controller_id": controller_id,
                    "manifest_url": manifest_url,
                    "firmware_base_url": firmware_base_url,
                },
                label="release-HIL feed lease retire",
            )
            validate_feed_lease(
                retired, controller_id=controller_id, expected_id=lease_id, active=False,
                manifest_url=manifest_url, firmware_base_url=firmware_base_url,
            )
        except BaseException as error:
            cleanup_error = error
        if cleanup_error is not None and primary is None:
            raise cleanup_error


def require_exact_release_hil_feed(
    manifest_url: str, firmware_base_url: str, manifest: bytes, app: bytes,
) -> None:
    """Bind the private HTTPS endpoint to the exact locally verified candidate bytes."""
    resources = (
        ("manifest", manifest_url, manifest),
        ("application", url_child(firmware_base_url, "daikin-altherma-esp32.bin"), app),
    )
    for label, url, expected in resources:
        request = Request(
            cache_busted(url), method="GET",
            headers={"User-Agent": "daikin-release-hil-gate/1"},
        )
        try:
            with NO_REDIRECT_OPENER.open(request, timeout=HTTP_TIMEOUT_S) as response:
                body = response.read(len(expected) + 1)
                if response.status != 200:
                    fail(f"release-HIL {label} readback returned HTTP {response.status}")
        except (OSError, TimeoutError, HTTPError) as error:
            fail(f"release-HIL {label} readback failed: {error}")
        if body != expected:
            fail(f"release-HIL {label} readback does not match the candidate bytes")


def read_release_hil_artifact(url: str, label: str, maximum: int) -> bytes:
    """Read one redirect-free, non-empty HIL artifact under an explicit memory bound."""
    if maximum <= 0:
        fail(f"release-HIL {label} has an invalid read bound")
    request = Request(
        cache_busted(url), method="GET",
        headers={"User-Agent": "daikin-release-hil-gate/1"},
    )
    try:
        with NO_REDIRECT_OPENER.open(request, timeout=HTTP_TIMEOUT_S) as response:
            body = response.read(maximum + 1)
            if response.status != 200:
                fail(f"release-HIL {label} returned HTTP {response.status}")
    except (OSError, TimeoutError, HTTPError) as error:
        fail(f"release-HIL {label} read failed: {error}")
    if not body or len(body) > maximum:
        fail(f"release-HIL {label} is empty or exceeds {maximum} bytes")
    return body


def verify_release_hil_bootstrap_artifact(lab: dict[str, Any]) -> dict[str, Any]:
    """Pin the independently hosted bootstrap feed to one signed ESP32-S3 application."""
    manifest_bytes = read_release_hil_artifact(
        lab["bootstrap_manifest_url"], "bootstrap manifest", RELEASE_HIL_MANIFEST_MAX_BYTES,
    )
    manifest = strict_json(manifest_bytes, "release-HIL bootstrap manifest")
    provenance = manifest.get("provenance") if isinstance(manifest, dict) else None
    if not isinstance(manifest, dict) or not isinstance(provenance, dict) or \
       manifest.get("version") != lab["bootstrap_version"] or \
       provenance.get("app_sha256") != lab["bootstrap_app_sha256"]:
        fail("release-HIL bootstrap manifest does not match the pinned version/application")
    candidates: list[str] = []
    builds = manifest.get("builds")
    if isinstance(builds, list):
        for build in builds:
            if not isinstance(build, dict) or build.get("chipFamily") != "ESP32-S3":
                continue
            parts = build.get("parts")
            if not isinstance(parts, list):
                continue
            for part in parts:
                if isinstance(part, dict) and part.get("offset") == 0x20000 and \
                   isinstance(part.get("path"), str):
                    candidates.append(part["path"])
    if candidates != ["daikin-altherma-esp32.bin"]:
        fail("release-HIL bootstrap manifest must name one canonical ESP32-S3 application")
    app_url = url_child(
        lab["bootstrap_firmware_base_url"], "daikin-altherma-esp32.bin",
    )
    app = read_release_hil_artifact(
        app_url, "bootstrap application", RELEASE_HIL_APP_MAX_BYTES,
    )
    if hashlib.sha256(app).hexdigest() != lab["bootstrap_app_sha256"]:
        fail("release-HIL bootstrap application does not match its pinned SHA-256")
    elf = verify_image(app, lab["bootstrap_version"], lab["bootstrap_app_sha256"])
    if elf != lab["bootstrap_elf"]:
        fail("release-HIL bootstrap application does not match its pinned ELF identity")
    verify_http_range_support(app_url, app)
    return {
        "version": lab["bootstrap_version"],
        "app_sha256": lab["bootstrap_app_sha256"],
        "elf": elf,
        "manifest_sha256": hashlib.sha256(manifest_bytes).hexdigest(),
    }


def require_release_hil_channel(status: dict[str, Any], channel: str) -> None:
    ota = status.get("ota")
    if not isinstance(ota, dict) or ota.get("channel") != channel:
        fail("release-HIL running image is not on the pinned OTA channel")


def validate_power_ack(
    result: dict[str, Any], lab: dict[str, Any], state: str, lease_id: str | None,
) -> str | None:
    outlet = lab["power_outlet"]
    if result.get("controller_id") != lab["power_controller_id"] or \
       result.get("outlet") != outlet or result.get("state") != state:
        fail(f"release-HIL power controller did not confirm {outlet}={state}")
    confirmed_lease = result.get("lease_id")
    if not isinstance(confirmed_lease, str) or \
       not re.fullmatch(r"[A-Za-z0-9._-]{16,128}", confirmed_lease):
        fail("release-HIL power controller did not return a valid lease id")
    if state == "off":
        if result.get("auto_on_after_s") != POWER_OFF_LEASE_S:
            fail("release-HIL power controller did not confirm the fail-safe auto-ON lease")
        return confirmed_lease
    if confirmed_lease != lease_id or result.get("lease_released") is not True:
        fail("release-HIL power controller did not release the exact OFF lease")
    return None


def power_set(
    lab: dict[str, Any], state: str, token: str, *, lease_id: str | None = None,
) -> str | None:
    if state not in ("off", "on"):
        fail(f"invalid release-HIL power state {state}")
    if state == "off" and lease_id is not None:
        fail("release-HIL power OFF must create, not reuse, an auto-ON lease")
    if state == "on" and (not isinstance(lease_id, str) or
                          not re.fullmatch(r"[A-Za-z0-9._-]{16,128}", lease_id)):
        fail("release-HIL power ON requires the exact OFF lease id")
    outlet = lab["power_outlet"]
    endpoint = url_child(lab["power_base_url"], "outlets", outlet, "state")
    payload = {"state": state}
    payload["controller_id"] = lab["power_controller_id"]
    if state == "off":
        payload["auto_on_after_s"] = POWER_OFF_LEASE_S
    else:
        payload["lease_id"] = lease_id
    result = control_json(
        endpoint, method="POST", token=token, payload=payload,
        label=f"release-HIL power {state}",
    )
    return validate_power_ack(result, lab, state, lease_id)


def release_hil_power_cycle(lab: dict[str, Any], token: str) -> None:
    # The controller itself guarantees auto-ON. If this process is killed after OFF, the board is
    # dark for at most POWER_OFF_LEASE_S rather than depending on a finally/Actions cleanup step.
    lease_id = power_set(lab, "off", token)
    assert lease_id is not None
    time.sleep(2)
    power_set(lab, "on", token, lease_id=lease_id)


def validate_cycle_watchdog_ack(
    result: dict[str, Any], lab: dict[str, Any], *, expected_id: str | None,
    state: str,
) -> str:
    watchdog_id = result.get("watchdog_id")
    if result.get("controller_id") != lab["power_controller_id"] or \
       result.get("outlet") != lab["power_outlet"] or \
       not isinstance(watchdog_id, str) or \
       re.fullmatch(r"[A-Za-z0-9._-]{16,128}", watchdog_id) is None or \
       (expected_id is not None and watchdog_id != expected_id):
        fail("release-HIL power controller returned the wrong cycle-watchdog identity")
    if state == "created":
        if result.get("armed") is not True or \
           result.get("expires_in_s") != PENDING_IMAGE_WATCHDOG_TTL_S or \
           result.get("action") != "power_cycle" or \
           result.get("off_duration_s") != PENDING_IMAGE_WATCHDOG_OFF_S:
            fail("release-HIL power controller did not arm the exact rollback watchdog")
    elif state == "armed":
        remaining = result.get("expires_in_s")
        if result.get("armed") is not True or not isinstance(remaining, int) or \
           not 1 <= remaining <= PENDING_IMAGE_WATCHDOG_TTL_S or \
           result.get("action") != "power_cycle" or \
           result.get("off_duration_s") != PENDING_IMAGE_WATCHDOG_OFF_S:
            fail("release-HIL rollback watchdog is no longer armed inside its hard deadline")
    elif state == "triggered":
        if result.get("cycle_completed") is not True or result.get("lease_released") is not True:
            fail("release-HIL power controller did not complete the watchdog power cycle")
    elif state == "released":
        if result.get("released") is not True or result.get("lease_released") is not True:
            fail("release-HIL power controller did not release the approved candidate watchdog")
    else:
        fail("invalid release-HIL cycle-watchdog acknowledgement state")
    return watchdog_id


@contextmanager
def pending_image_power_watchdog(lab: dict[str, Any], token: str):
    """Own one non-renewable deadline until the runner cycles or approves the candidate."""
    collection = url_child(
        lab["power_base_url"], "outlets", lab["power_outlet"], "cycle-watchdogs",
    )
    created = control_json(
        collection, method="POST", token=token,
        payload={
            "controller_id": lab["power_controller_id"],
            "ttl_s": PENDING_IMAGE_WATCHDOG_TTL_S,
            "action": "power_cycle",
            "off_duration_s": PENDING_IMAGE_WATCHDOG_OFF_S,
        },
        label="release-HIL pending-image watchdog create",
    )
    watchdog_id = validate_cycle_watchdog_ack(
        created, lab, expected_id=None, state="created",
    )
    watchdog_url = url_child(
        lab["power_base_url"], "outlets", lab["power_outlet"], "cycle-watchdogs",
        watchdog_id,
    )
    triggered = False
    released = False

    def require_active() -> None:
        if triggered or released:
            fail("release-HIL pending-image watchdog is no longer active")
        active = control_json(
            watchdog_url, method="GET", token=token, payload=None,
            label="release-HIL pending-image watchdog status",
        )
        validate_cycle_watchdog_ack(
            active, lab, expected_id=watchdog_id, state="armed",
        )

    def trigger_now() -> None:
        nonlocal triggered
        if triggered:
            fail("release-HIL pending-image watchdog was triggered twice")
        if released:
            fail("release-HIL approved-candidate watchdog cannot be triggered")
        require_active()
        result = control_json(
            watchdog_url + "/trigger", method="POST", token=token,
            payload={"controller_id": lab["power_controller_id"]},
            label="release-HIL pending-image watchdog trigger",
        )
        validate_cycle_watchdog_ack(
            result, lab, expected_id=watchdog_id, state="triggered",
        )
        triggered = True

    def release_approved() -> None:
        nonlocal released
        if triggered or released:
            fail("release-HIL pending-image watchdog already reached a terminal state")
        require_active()
        result = control_json(
            watchdog_url + "/release", method="POST", token=token,
            payload={"controller_id": lab["power_controller_id"]},
            label="release-HIL approved-candidate watchdog release",
        )
        validate_cycle_watchdog_ack(
            result, lab, expected_id=watchdog_id, state="released",
        )
        released = True

    primary: BaseException | None = None
    try:
        yield require_active, trigger_now, release_approved
        if not triggered and not released:
            fail("release-HIL pending-image watchdog left scope without a terminal action")
    except BaseException as error:
        primary = error
        raise
    finally:
        if not triggered and not released:
            try:
                # On an ordinary exception, cycle immediately. If this request itself fails or the
                # process is hard-killed, the controller's non-renewable lease still expires before
                # the candidate can reach the firmware's 90-second health-commit boundary.
                result = control_json(
                    watchdog_url + "/trigger", method="POST", token=token,
                    payload={"controller_id": lab["power_controller_id"]},
                    label="release-HIL pending-image watchdog emergency trigger",
                )
                validate_cycle_watchdog_ack(
                    result, lab, expected_id=watchdog_id, state="triggered",
                )
            except BaseException:
                if primary is None:
                    raise


def wait_for_identity(
    host: str, mac: str, version: str, elf: str, *, timeout_s: int = 180,
) -> dict[str, Any]:
    deadline = time.monotonic() + timeout_s
    last: BaseException | None = None
    while time.monotonic() < deadline:
        try:
            endpoint = resolve_http_endpoint(host)
        except GateError as error:
            last = error
        else:
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                break
            try:
                status = request_status_deadline(
                    endpoint, timeout=min(remaining, HTTP_TIMEOUT_S),
                )
            except (CompactTransportError, OSError, TimeoutError, HTTPError) as error:
                last = error
            else:
                if status.get("version") == version and status.get("app_elf_sha256") == elf:
                    validate_identity(status, host=host, mac=mac, version=version, elf=elf)
                    return status
        remaining = deadline - time.monotonic()
        if remaining > 0:
            time.sleep(min(1, remaining))
    fail(f"{host} did not return on {version}/{elf} after power cycle ({last})")


def wait_for_ota_image_state(
    endpoint: ResolvedHttpEndpoint, *, rollback_pending: bool, timeout_s: int = 20,
) -> dict[str, Any]:
    """Observe the boot-latched IDF image state without reading flash on the HTTP task."""
    expected_state = "pending_verify" if rollback_pending else "valid"
    deadline = time.monotonic() + timeout_s
    last: BaseException | None = None
    while time.monotonic() < deadline:
        try:
            status = request_json_deadline(
                endpoint, "/ota/status", timeout=OTA_STATUS_REQUEST_TIMEOUT_S,
            )
            state = status.get("image_state")
            pending = status.get("rollback_pending")
            if state == expected_state and pending is rollback_pending:
                return status
            if rollback_pending and state in ("valid", "unarmed"):
                fail("release-HIL candidate was no longer rollback-armed before the forced cycle")
            if not rollback_pending and state == "unarmed":
                fail("release-HIL OTA candidate lost its rollback metadata without becoming valid")
            last = GateError(f"observed image_state={state!r}, rollback_pending={pending!r}")
        except HTTPError as error:
            if error.code != 503:
                raise
            last = error
        except (CompactTransportError, OSError, TimeoutError) as error:
            last = error
        time.sleep(0.1)
    fail(
        f"release-HIL did not observe image_state={expected_state}/"
        f"rollback_pending={rollback_pending} within {timeout_s}s ({last})"
    )


def release_hil_install_once(
    *, host: str, mac: str, current_version: str, current_elf: str,
    version: str, app_sha256: str, elf: str, channel: str,
    manifest_url: str, firmware_base_url: str, allow_downgrade: bool = False,
) -> tuple[dict[str, Any], dict[str, Any]]:
    endpoint = resolve_http_endpoint(host)
    pinned_before = request_status_deadline(endpoint, timeout=HTTP_TIMEOUT_S)
    validate_identity(
        pinned_before, host=host, mac=mac, version=current_version, elf=current_elf,
    )
    require_release_hil_channel(pinned_before, channel)
    generation = wait_for_ota_offer(
        endpoint, version, app_sha256, expected_channel=channel,
        allow_downgrade=allow_downgrade,
        hil_manifest_url=manifest_url, hil_firmware_base_url=firmware_base_url,
    )
    post_update_once(
        endpoint, generation, version, app_sha256, expected_channel=channel,
        allow_downgrade=allow_downgrade,
    )
    transfer: dict[str, Any] = {}
    status = wait_for_new_firmware(host, version, elf, endpoint, transfer)
    validate_identity(status, host=host, mac=mac, version=version, elf=elf)
    require_release_hil_channel(status, channel)
    pending = wait_for_ota_image_state(endpoint, rollback_pending=True)
    post_witness_status = request_status_deadline(endpoint, timeout=HTTP_TIMEOUT_S)
    validate_identity(
        post_witness_status, host=host, mac=mac, version=version, elf=elf,
    )
    require_release_hil_channel(post_witness_status, channel)
    transfer["post_boot_image_state"] = {
        "image_state": pending.get("image_state"),
        "rollback_pending": pending.get("rollback_pending"),
    }
    require_ota_transfer_evidence(
        host, transfer, phase="release-HIL",
        writer_version=current_version, writer_elf=current_elf,
    )
    return post_witness_status, transfer


def run_release_hil(
    *, manifest_path: Path, app_path: Path, source_sha: str, version: str,
    app_sha256: str, power_token: str, feed_token: str,
) -> dict[str, Any]:
    verify_release_hil_source(source_sha)
    if not power_token or len(power_token) > 4096:
        fail("RELEASE_HIL_POWER_TOKEN is missing or invalid")
    if not feed_token or len(feed_token) > 4096:
        fail("RELEASE_HIL_FEED_TOKEN is missing or invalid")
    if not manifest_path.is_file() or not app_path.is_file():
        fail("release-HIL artifact manifest or app is missing")
    run_checked([
        str(ROOT / "scripts/check-manifest-provenance.py"), str(manifest_path), str(app_path),
        source_sha, run_checked([str(ROOT / "scripts/idf-version.sh")], capture=True).strip(),
        str(ROOT / "dependencies.lock"),
    ])
    manifest_bytes = manifest_path.read_bytes()
    app_bytes = app_path.read_bytes()
    manifest = strict_json(manifest_bytes, "release-HIL manifest")
    provenance = manifest.get("provenance") if isinstance(manifest, dict) else None
    if not isinstance(manifest, dict) or not isinstance(provenance, dict) or \
       manifest.get("version") != version or provenance.get("source_sha") != source_sha or \
       provenance.get("app_sha256") != app_sha256:
        fail("release-HIL artifact identity does not match its arguments")
    if hashlib.sha256(app_bytes).hexdigest() != app_sha256:
        fail("release-HIL app bytes do not match expected SHA-256")
    elf = verify_image(app_bytes, version, app_sha256)

    lab = load_release_hil_inventory()
    bootstrap_artifact = verify_release_hil_bootstrap_artifact(lab)
    host = lab["host"]
    mac = lab["mac"]
    initial_endpoint = resolve_http_endpoint(host)
    before = request_status_deadline(initial_endpoint, timeout=HTTP_TIMEOUT_S)
    old_version = str(before.get("version", ""))
    old_elf = str(before.get("app_elf_sha256", ""))
    if old_version != lab["bootstrap_version"] or old_elf != lab["bootstrap_elf"] or \
       old_version == version:
        fail("release-HIL board is not on its independently pinned bootstrap version/ELF")
    validate_identity(before, host=host, mac=mac, version=old_version, elf=old_elf)
    require_release_hil_channel(before, lab["channel"])
    baseline_counters = board_counters(before)
    if any(baseline_counters[key] != 0 for key in ("heap_restarts", "mqtt_skipped", "poll_skipped")):
        fail(f"release-HIL board already reports allocation failures: {baseline_counters}")
    persistent = persistence_snapshot(
        before, lab["persistence_paths"], lab["persistence_canaries"],
    )

    with leased_release_hil_feed(
        lab["feed_control_url"], lab["feed_controller_id"],
        lab["manifest_url"], lab["firmware_base_url"], manifest_bytes, app_bytes, feed_token,
    ) as require_feed_active:
        require_exact_release_hil_feed(
            lab["manifest_url"], lab["firmware_base_url"], manifest_bytes, app_bytes,
        )
        require_feed_active()
        with pending_image_power_watchdog(lab, power_token) as (
            require_watchdog_active, trigger_watchdog_cycle, _approve_first_candidate,
        ):
            require_watchdog_active()
            first_status, first_transfer = release_hil_install_once(
                host=host, mac=mac, current_version=old_version, current_elf=old_elf,
                version=version, app_sha256=app_sha256, elf=elf,
                channel=lab["channel"], manifest_url=lab["manifest_url"],
                firmware_base_url=lab["firmware_base_url"],
            )
            if required_uptime(first_status, "release-HIL first candidate") > 45:
                fail("release-HIL first candidate was not power-cycled while rollback remained armed")
            require_watchdog_active()
            trigger_watchdog_cycle()
        rolled_back = wait_for_identity(host, mac, old_version, old_elf)
        require_release_hil_channel(rolled_back, lab["channel"])
        if rolled_back.get("history", {}).get("persist") != "power_cycle":
            fail("release-HIL rollback restart did not report the history power-cycle boundary")
        if persistence_snapshot(
            rolled_back, lab["persistence_paths"], lab["persistence_canaries"],
        ) != persistent:
            fail("release-HIL configuration changed across pending-image rollback")

        require_feed_active()
        with pending_image_power_watchdog(lab, power_token) as (
            require_commit_watchdog_active, _trigger_commit_watchdog,
            approve_commit_candidate,
        ):
            require_commit_watchdog_active()
            second_status, second_transfer = release_hil_install_once(
                host=host, mac=mac, current_version=old_version, current_elf=old_elf,
                version=version, app_sha256=app_sha256, elf=elf,
                channel=lab["channel"], manifest_url=lab["manifest_url"],
                firmware_base_url=lab["firmware_base_url"],
            )
            if required_uptime(second_status, "release-HIL approved candidate") > 45:
                fail("release-HIL candidate missed its pre-commit watchdog approval boundary")
            require_commit_watchdog_active()
            approve_commit_candidate()
        health = wait_for_bench_health_window(
            host, mac, version, elf, phase="target",
        )
        committed_endpoint = resolve_http_endpoint(host)
        committed_status = request_status_deadline(
            committed_endpoint, timeout=HTTP_TIMEOUT_S,
        )
        validate_identity(
            committed_status, host=host, mac=mac, version=version, elf=elf,
        )
        wait_for_ota_image_state(committed_endpoint, rollback_pending=False)
        release_hil_power_cycle(lab, power_token)
        cold = wait_for_identity(host, mac, version, elf)
        require_release_hil_channel(cold, lab["channel"])
        cold_endpoint = resolve_http_endpoint(host)
        cold_pinned = request_status_deadline(cold_endpoint, timeout=HTTP_TIMEOUT_S)
        validate_identity(cold_pinned, host=host, mac=mac, version=version, elf=elf)
        wait_for_ota_image_state(cold_endpoint, rollback_pending=False)
        if persistence_snapshot(
            cold, lab["persistence_paths"], lab["persistence_canaries"],
        ) != persistent:
            fail("release-HIL configuration changed across committed-image cold restart")
        if cold.get("history", {}).get("persist") != "power_cycle":
            fail("release-HIL cold restart did not report the history power-cycle boundary")

        # Prove the committed candidate's own OTA writer, rather than only the bootstrap writer
        # used by the two candidate installs above. The candidate downloads and selects the exact
        # independently pinned signed bootstrap as PENDING_VERIFY. A hard controller-owned cycle
        # then makes the bootloader roll back to the already-VALID candidate.
        require_feed_active()
        with pending_image_power_watchdog(lab, power_token) as (
            require_writer_watchdog_active, trigger_writer_watchdog_cycle,
            _approve_bootstrap_candidate,
        ):
            require_writer_watchdog_active()
            bootstrap_status, candidate_writer_transfer = release_hil_install_once(
                host=host, mac=mac, current_version=version, current_elf=elf,
                version=lab["bootstrap_version"],
                app_sha256=lab["bootstrap_app_sha256"], elf=lab["bootstrap_elf"],
                channel=lab["channel"], manifest_url=lab["bootstrap_manifest_url"],
                firmware_base_url=lab["bootstrap_firmware_base_url"],
                allow_downgrade=True,
            )
            if required_uptime(
                bootstrap_status, "release-HIL candidate-writer bootstrap",
            ) > 45:
                fail("release-HIL candidate-writer rollback missed its watchdog boundary")
            require_writer_watchdog_active()
            trigger_writer_watchdog_cycle()
        writer_rollback = wait_for_identity(host, mac, version, elf)
        require_release_hil_channel(writer_rollback, lab["channel"])
        if writer_rollback.get("history", {}).get("persist") != "power_cycle":
            fail("release-HIL candidate-writer rollback did not cross a power-cycle boundary")
        writer_endpoint = resolve_http_endpoint(host)
        writer_pinned = request_status_deadline(writer_endpoint, timeout=HTTP_TIMEOUT_S)
        validate_identity(writer_pinned, host=host, mac=mac, version=version, elf=elf)
        require_release_hil_channel(writer_pinned, lab["channel"])
        writer_image_state = wait_for_ota_image_state(
            writer_endpoint, rollback_pending=False,
        )
        if persistence_snapshot(
            writer_pinned, lab["persistence_paths"], lab["persistence_canaries"],
        ) != persistent:
            fail("release-HIL configuration changed across candidate-writer rollback")

        require_feed_active()
        stress = stress_board(
            host=host, mac=mac, version=version, elf=elf,
            require_x10a=lab["require_x10a"], require_weather=lab["require_weather"],
            expected_app_sha256=app_sha256, expected_channel=lab["channel"],
            hil_manifest_url=lab["manifest_url"],
            hil_firmware_base_url=lab["firmware_base_url"],
        )
        final_endpoint = resolve_http_endpoint(host)
        final = request_status_deadline(final_endpoint, timeout=HTTP_TIMEOUT_S)
        validate_identity(final, host=host, mac=mac, version=version, elf=elf)
        require_release_hil_channel(final, lab["channel"])
        stack = require_stack_evidence(
            final, lab["required_stack_tasks"], lab["min_stack_free_bytes"],
        )
    return {
        "artifact": {
            "source_sha": source_sha,
            "version": version,
            "app_sha256": app_sha256,
            "elf": elf,
        },
        "lab": {
            "role": RELEASE_HIL_ROLE,
            "rollback_from": version,
            "rollback_to": old_version,
            "first_transfer": first_transfer,
            "second_transfer": second_transfer,
            "bootstrap_artifact": bootstrap_artifact,
            "candidate_writer_transfer": candidate_writer_transfer,
            "candidate_writer_pending_uptime_s": bootstrap_status.get("uptime_s"),
            "candidate_writer_rollback": {
                "version": writer_pinned.get("version"),
                "elf": writer_pinned.get("app_elf_sha256"),
                "image_state": writer_image_state.get("image_state"),
                "rollback_pending": writer_image_state.get("rollback_pending"),
            },
            "committed_health_uptime_s": health.get("uptime_s"),
            "cold_restore": "power_cycle",
            "stack_min_free_bytes": stack,
            "stress": stress,
        },
    }


def self_test() -> None:
    global HTTP_TIMEOUT_S
    source = "a" * 40
    app = "b" * 64
    class LimitedResponse:
        status = 200

        def __init__(self, body: bytes, declared: str | None = None) -> None:
            self.body = body
            self.headers = {} if declared is None else {"Content-Length": declared}

        def __enter__(self) -> "LimitedResponse":
            return self

        def __exit__(self, *_args: Any) -> None:
            return None

        def read(self, limit: int) -> bytes:
            return self.body[:limit]

    class SlowLimitedResponse(LimitedResponse):
        def read(self, limit: int) -> bytes:
            time.sleep(0.20)
            return super().read(limit)

    original_urlopen = globals()["urlopen"]
    try:
        globals()["urlopen"] = lambda *_args, **_kwargs: LimitedResponse(b"x" * 1025)
        try:
            request_limited_bytes("https://feed.invalid/manifest.json", "fixture", 1024)
        except GateError:
            pass
        else:
            raise AssertionError("bounded remote document reader accepted an oversized body")
        globals()["urlopen"] = lambda *_args, **_kwargs: LimitedResponse(
            b"x", declared="1025",
        )
        try:
            request_limited_bytes("https://feed.invalid/manifest.json", "fixture", 1024)
        except GateError:
            pass
        else:
            raise AssertionError("bounded remote document reader trusted oversized Content-Length")
        globals()["urlopen"] = lambda *_args, **_kwargs: SlowLimitedResponse(b"x")
        started = time.monotonic()
        try:
            request_limited_bytes(
                "https://feed.invalid/manifest.json", "fixture", 1024, timeout=0.02,
            )
        except GateError:
            pass
        else:
            raise AssertionError("bounded remote document reader accepted a slow trickle")
        if time.monotonic() - started > 0.15:
            raise AssertionError("bounded remote document reader exceeded its absolute deadline")
    finally:
        globals()["urlopen"] = original_urlopen
    for ambiguous in (
        '{"controller_id":"hil-feed-controller","controller_id":"production-controller"}',
        '{"lease_id":"fixture-lease-0123456789","ttl_s":NaN}',
    ):
        try:
            strict_json(ambiguous, "ambiguous controller fixture")
        except GateError:
            pass
        else:
            raise AssertionError("strict JSON decoder accepted ambiguous controller evidence")
    fixture = {
        "version": "1.2.3-dev.4",
        "provenance": {"source_sha": source, "app_sha256": app},
        "builds": [{"chipFamily": "ESP32-S3", "parts": [{"path": "app.bin", "offset": 0x20000}]}],
    }
    assert validate_manifest(OFFICIAL_MANIFEST_URL, fixture, source, "1.2.3-dev.4", app) == "https://0bu.github.io/daikin-altherma-esp32/dev/app.bin"
    compact_manifest = json.dumps(fixture, separators=(",", ":")).encode()
    require_legacy_bench_restore_manifest(compact_manifest, fixture)
    original_limited_request = globals()["request_limited_bytes"]
    try:
        globals()["request_limited_bytes"] = lambda *_args, **_kwargs: compact_manifest
        require_official_dev_manifest_snapshot(
            hashlib.sha256(compact_manifest).hexdigest(), source, "1.2.3-dev.4", app,
        )
        try:
            require_official_dev_manifest_snapshot("0" * 64, source, "1.2.3-dev.4", app)
        except GateError:
            pass
        else:
            raise AssertionError("dev manifest rebind accepted replaced bytes")
    finally:
        globals()["request_limited_bytes"] = original_limited_request
    try:
        require_legacy_bench_restore_manifest(
            b"x" * (LEGACY_BENCH_RESTORE_MANIFEST_MAX_BYTES + 1), fixture,
        )
    except GateError:
        pass
    else:
        raise AssertionError("legacy bench restore preflight accepted an oversized manifest")
    embedded_artifacts = {**fixture, "artifacts": []}
    try:
        require_legacy_bench_restore_manifest(compact_manifest, embedded_artifacts)
    except GateError:
        pass
    else:
        raise AssertionError("legacy bench restore preflight accepted an embedded artifact index")
    escaped_manifest = compact_manifest.replace(b"dev.4", b"dev.\\u0034")
    escaped_fixture = strict_json(escaped_manifest, "escaped legacy fixture")
    assert escaped_fixture == fixture
    try:
        require_legacy_bench_restore_manifest(escaped_manifest, escaped_fixture)
    except GateError:
        pass
    else:
        raise AssertionError("legacy bench restore preflight accepted an escaped identity")
    release_fixture = {
        **fixture,
        "version": "1.2.3",
        "provenance": {"source_sha": source, "app_sha256": app},
    }
    assert validate_release_manifest(
        OFFICIAL_RELEASE_MANIFEST_URL, release_fixture,
    ) == ("1.2.3", app, "https://0bu.github.io/daikin-altherma-esp32/app.bin", source)
    require_release_source_binding("1.2.3", source, app, source)
    require_release_source_binding(
        LEGACY_RELEASE_VERSION, LEGACY_RELEASE_SOURCE_SHA, LEGACY_RELEASE_APP_SHA256,
        "c" * 40,
    )
    try:
        require_release_source_binding("1.2.3", source, app, "c" * 40)
    except GateError:
        pass
    else:
        raise AssertionError("release source binding accepted an unadjudicated tag mismatch")
    try:
        validate_manifest("https://example.test/project/manifest.json", fixture, source, "1.2.3-dev.4", app)
    except GateError:
        pass
    else:
        raise AssertionError("release manifest passed the dev-only gate")
    fixture_mac = ":".join(["02", "00", "00", "00", "00", "01"])
    production_fixture_mac = ":".join(["02", "00", "00", "00", "00", "02"])
    healthy = {
        "version": "x", "app_elf_sha256": "e",
        "wifi": {"mac": fixture_mac, "connected": True, "rolled_back": False},
        "sys": {"safe_mode": False}, "last_crash": None,
    }
    validate_identity(healthy, host="bench.invalid", mac=fixture_mac, version="x", elf="e")
    assert board_counters({
        "sys": {"heap_restarts": 0, "mqtt_skipped": 0, "poll_skipped": 0},
        "hp": {"crc_err": 1, "timeout_err": 2},
    })["timeout_err"] == 2
    for incomplete_counters in (
        {},
        {
            "sys": {"heap_restarts": 0, "mqtt_skipped": 0, "poll_skipped": 0},
            "hp": {"crc_err": 0},
        },
    ):
        try:
            board_counters(incomplete_counters)
        except GateError:
            pass
        else:
            raise AssertionError("missing board counters were interpreted as healthy zeroes")
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

    # /status and /values are deliberately streamed by the firmware. Prove a body larger than the
    # compact 4 KiB observer cap survives multiple HTTP chunks and fragmented socket receives.
    streamed_value = {"padding": "x" * 9000, "uptime_s": 7}
    streamed_body = json.dumps(streamed_value, separators=(",", ":")).encode()
    streamed_chunks = (streamed_body[:17], streamed_body[17:4099], streamed_body[4099:])
    streamed_wire = bytearray(
        b"HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\nConnection: close\r\n\r\n"
    )
    for streamed_chunk in streamed_chunks:
        streamed_wire.extend(f"{len(streamed_chunk):X}\r\n".encode())
        streamed_wire.extend(streamed_chunk + b"\r\n")
    streamed_wire.extend(b"0\r\n\r\n")
    streamed_client, streamed_server = socket.socketpair()

    def send_streamed_status() -> None:
        with streamed_server:
            for offset in range(0, len(streamed_wire), 113):
                streamed_server.sendall(streamed_wire[offset:offset + 113])

    streamed_thread = threading.Thread(target=send_streamed_status, daemon=True)
    streamed_thread.start()
    assert read_bounded_json_response(
        streamed_client, "fixture.invalid", "/status", time.monotonic() + 1,
        max_body_bytes=STATUS_MAX_BYTES, allow_chunked=True,
    ) == streamed_value
    streamed_client.close()
    streamed_thread.join(1)

    chunk_failures: tuple[tuple[bytes, type[BaseException]], ...] = (
        (
            b"HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n"
            b"ZZ\r\n{}\r\n0\r\n\r\n",
            GateError,
        ),
        (
            b"HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n"
            b"5\r\n{}\r\n",
            CompactTransportError,
        ),
        (
            b"HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n" +
            f"{STATUS_MAX_BYTES + 1:X}\r\n".encode(),
            GateError,
        ),
        (
            b"HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n"
            b"2\r\n{}\r\n0\r\n\r\nextra",
            GateError,
        ),
        (
            b"HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n"
            b"2;fixture=yes\r\n{}\r\n0\r\n\r\n",
            GateError,
        ),
        (
            b"HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n"
            b"2\r\n{}\r\n0\r\nX-Fixture: trailer\r\n\r\n",
            GateError,
        ),
        (
            b"HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n" +
            b"1" * (HTTP_CHUNK_LINE_MAX_BYTES + 1) + b"\r\n",
            GateError,
        ),
        (
            b"HTTP/1.1 503 Service Unavailable\r\nContent-Length: 2\r\n"
            b"Transfer-Encoding: chunked\r\n\r\n{}",
            GateError,
        ),
    )
    for response, expected_error in chunk_failures:
        chunk_client, chunk_server = socket.socketpair()
        with chunk_server:
            chunk_server.sendall(response)
        try:
            read_bounded_json_response(
                chunk_client, "fixture.invalid", "/status", time.monotonic() + 0.25,
                max_body_bytes=STATUS_MAX_BYTES, allow_chunked=True,
            )
        except expected_error:
            pass
        else:
            raise AssertionError("malformed/truncated/oversized chunked status was accepted")
        finally:
            chunk_client.close()

    compact_chunked_client, compact_chunked_server = socket.socketpair()
    with compact_chunked_server:
        compact_chunked_server.sendall(
            b"HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n2\r\n{}\r\n0\r\n\r\n"
        )
    try:
        read_compact_json_response(
            compact_chunked_client, "fixture.invalid", "/ota/status", time.monotonic() + 0.25,
        )
    except GateError:
        pass
    else:
        raise AssertionError("compact /ota/status accepted chunked transfer framing")
    finally:
        compact_chunked_client.close()

    for invalid_uptime in (None, True, -1, "7"):
        try:
            required_uptime({"uptime_s": invalid_uptime}, "fixture status")
        except GateError:
            pass
        else:
            raise AssertionError("invalid stress uptime was accepted")
    exact_offer = {
        "state": "idle", "available": "1.2.3", "available_sha256": app,
        "available_channel": "release",
    }
    require_stress_ota_offer(
        exact_offer, version="1.2.3", app_sha256=app, channel="release",
    )
    for wrong_offer in (
        {**exact_offer, "available_sha256": "f" * 64},
        {**exact_offer, "available_channel": "dev"},
    ):
        try:
            require_stress_ota_offer(
                wrong_offer, version="1.2.3", app_sha256=app, channel="release",
            )
        except GateError:
            pass
        else:
            raise AssertionError("stress accepted the wrong OTA artifact identity")

    busy_weather = {
        "weather_forecast": {
            "configured": True, "fetching": True, "latitude": "1", "longitude": "2",
            "successes": 3,
        },
    }
    try:
        request_weather_refresh(
            ResolvedHttpEndpoint(socket.AF_INET, socket.SOCK_STREAM, 0, ("192.0.2.1", 80),
                                 "fixture.invalid"),
            "fixture.invalid", busy_weather,
        )
    except GateError:
        pass
    else:
        raise AssertionError("weather refresh was queued over an already-running fetch")

    pressure_counts: dict[str, int] = {"status_ok": 3}
    pressure_unexpected: list[str] = []
    record_bench_pressure_failure(
        "status", GateError("malformed chunk fixture"), pressure_counts,
        pressure_unexpected, threading.Lock(),
    )
    assert pressure_unexpected == ["status: malformed chunk fixture"]

    # The sole update POST consumes one already-resolved sockaddr. A hostile second resolver answer
    # must be irrelevant after the endpoint's /status identity was validated.
    pinned_client, pinned_peer = socket.socketpair()
    received: list[bytes] = []

    def accept_pinned_post() -> None:
        with pinned_peer as connection:
            request = bytearray()
            while b"\r\n\r\n" not in request:
                request.extend(connection.recv(1024))
            received.append(bytes(request))
            response = b'{"ok":true,"generation":8}'
            connection.sendall(
                b"HTTP/1.1 200 OK\r\nContent-Length: " + str(len(response)).encode() +
                b"\r\nConnection: close\r\n\r\n" + response
            )

    pinned_server = threading.Thread(target=accept_pinned_post, daemon=True)
    pinned_server.start()
    pinned_endpoint = ResolvedHttpEndpoint(
        socket.AF_INET, socket.SOCK_STREAM, 0, ("192.0.2.1", 80), "hil.invalid",
    )
    original_getaddrinfo = socket.getaddrinfo
    original_socket = socket.socket

    class PinnedSocket:
        def settimeout(self, timeout: float) -> None:
            pinned_client.settimeout(timeout)

        def connect(self, _sockaddr: tuple[Any, ...]) -> None:
            return None

        def sendall(self, data: bytes) -> None:
            pinned_client.sendall(data)

        def recv(self, size: int) -> bytes:
            return pinned_client.recv(size)

        def close(self) -> None:
            pinned_client.close()

    def reject_second_resolution(*_args: Any, **_kwargs: Any) -> Any:
        raise AssertionError("update path performed a second DNS resolution")

    socket.getaddrinfo = reject_second_resolution
    socket.socket = lambda *_args, **_kwargs: PinnedSocket()
    try:
        assert post_update_once(
            pinned_endpoint, 7, "1.2.3", "b" * 64, expected_channel="release",
        ) == 8
    finally:
        socket.socket = original_socket
        socket.getaddrinfo = original_getaddrinfo
    pinned_server.join(1)
    assert received and received[0].startswith(b"POST /ota/update?")

    with tempfile.TemporaryDirectory(prefix="daikin-production-ota-selftest-") as tmp:
        inventory_path = Path(tmp) / "inventory.json"
        inventory_path.write_text(json.dumps({
            "schema_version": 1,
            "bench": {"host": "bench.invalid", "mac": fixture_mac},
            "production": {
                "host": "production.invalid",
                "mac": production_fixture_mac,
            },
        }))
        assert load_inventory(inventory_path)[PRODUCTION_ROLE]["host"] == "production.invalid"
        hil_path = Path(tmp) / "release-hil.json"
        policy_path = Path(tmp) / "release-hil-policy.json"
        authorized_lab = {
            "host": "hil.invalid",
            "mac": fixture_mac,
            "bootstrap_version": "1.2.2-hil.1",
            "bootstrap_elf": "123456789",
            "bootstrap_app_sha256": "c" * 64,
            "bootstrap_manifest_url": "https://bootstrap-feed.invalid/firmware/manifest.json",
            "bootstrap_firmware_base_url": "https://bootstrap-feed.invalid/firmware/",
            "manifest_url": "https://hil-feed.invalid/firmware/manifest.json",
            "firmware_base_url": "https://hil-feed.invalid/firmware/",
            "feed_control_url": "https://hil-control.invalid/api/",
            "feed_controller_id": "hil-feed-controller",
            "power_base_url": "https://power.invalid/api/",
            "power_controller_id": "hil-power-controller",
            "power_outlet": "release-lab",
        }
        policy_path.write_text(json.dumps({
            "schema_version": 3,
            "authorized_lab": authorized_lab,
            "forbidden_production": {
                "hosts": ["production.invalid"],
                "macs": [production_fixture_mac],
                "feed_controller_ids": ["production-feed-controller"],
                "power_endpoints": [
                    {"controller_id": "production-power-controller", "outlet": "production"},
                ],
            },
        }))
        hil_path.write_text(json.dumps({
            "schema_version": 3,
            "lab": {
                "host": "hil.invalid",
                "mac": fixture_mac,
                "bootstrap_version": "1.2.2-hil.1",
                "bootstrap_elf": "123456789",
                "bootstrap_app_sha256": "c" * 64,
                "bootstrap_manifest_url":
                    "https://bootstrap-feed.invalid/firmware/manifest.json",
                "bootstrap_firmware_base_url": "https://bootstrap-feed.invalid/firmware/",
                "channel": "release",
                "manifest_url": "https://hil-feed.invalid/firmware/manifest.json",
                "firmware_base_url": "https://hil-feed.invalid/firmware/",
                "feed_control_url": "https://hil-control.invalid/api/",
                "feed_controller_id": "hil-feed-controller",
                "persistence_paths": [
                    "hp.rx", "hp.tx", "profile.id", "ota.channel",
                    "mqtt.base", "mqtt.base_custom",
                ],
                "persistence_canaries": {
                    "mqtt.base": "daikin-altherma-esp32/release-hil-canary-0123456789abcdef",
                    "mqtt.base_custom": True,
                },
                "required_stack_tasks": ["httpd", "poll", "mqtt", "weather"],
                "min_stack_free_bytes": 1024,
                "require_x10a": True,
                "require_weather": True,
            },
            "power": {
                "base_url": "https://power.invalid/api/",
                "controller_id": "hil-power-controller",
                "outlet": "release-lab",
            },
        }))
        hil = load_release_hil_inventory(
            hil_path, policy_path=policy_path, require_root_policy=False,
        )
        assert hil["channel"] == "release" and hil["feed_control_url"].startswith("https://")
        bootstrap_app = b"signed-bootstrap-fixture"
        bootstrap_sha = hashlib.sha256(bootstrap_app).hexdigest()
        bootstrap_lab = {
            **hil,
            "bootstrap_version": "1.2.2-hil.1",
            "bootstrap_elf": "123456789",
            "bootstrap_app_sha256": bootstrap_sha,
        }
        bootstrap_manifest = json.dumps({
            "version": bootstrap_lab["bootstrap_version"],
            "provenance": {"app_sha256": bootstrap_sha},
            "builds": [{
                "chipFamily": "ESP32-S3",
                "parts": [{"path": "daikin-altherma-esp32.bin", "offset": 0x20000}],
            }],
        }).encode()
        bootstrap_originals = {
            name: globals()[name]
            for name in (
                "read_release_hil_artifact", "verify_image", "verify_http_range_support",
            )
        }
        range_calls: list[tuple[str, bytes]] = []

        def fake_bootstrap_read(url: str, label: str, maximum: int) -> bytes:
            if label == "bootstrap manifest":
                assert url == bootstrap_lab["bootstrap_manifest_url"]
                assert maximum == RELEASE_HIL_MANIFEST_MAX_BYTES
                return bootstrap_manifest
            assert label == "bootstrap application"
            assert url == bootstrap_lab["bootstrap_firmware_base_url"] + \
                "daikin-altherma-esp32.bin"
            assert maximum == RELEASE_HIL_APP_MAX_BYTES
            return bootstrap_app

        globals()["read_release_hil_artifact"] = fake_bootstrap_read
        globals()["verify_image"] = lambda binary, version, sha: (
            "123456789" if binary == bootstrap_app and
            version == bootstrap_lab["bootstrap_version"] and sha == bootstrap_sha else "wrong"
        )
        globals()["verify_http_range_support"] = \
            lambda url, binary: range_calls.append((url, binary))
        try:
            bootstrap_evidence = verify_release_hil_bootstrap_artifact(bootstrap_lab)
            assert bootstrap_evidence["app_sha256"] == bootstrap_sha
            assert bootstrap_evidence["elf"] == "123456789"
            assert range_calls == [(
                bootstrap_lab["bootstrap_firmware_base_url"] +
                "daikin-altherma-esp32.bin", bootstrap_app,
            )]
        finally:
            for name, original in bootstrap_originals.items():
                globals()[name] = original
        for noncanonical_url in (
            "https://hil-control.invalid/api/../leases/",
            "https://hil-control.invalid/api//leases/",
            "https://hil-control.invalid/api/%2fleases/",
            "https://hil-control.invalid/api/%2e%2e/",
        ):
            try:
                canonical_https_url(
                    noncanonical_url, "noncanonical self-test URL", directory=True,
                )
            except GateError:
                pass
            else:
                raise AssertionError("release-HIL accepted a noncanonical controller URL")
        for unsafe_outlet in (".", ".."):
            try:
                url_child("https://power.invalid/api/", "outlets", unsafe_outlet, "state")
            except GateError:
                pass
            else:
                raise AssertionError("release-HIL accepted a dot-segment outlet")
        for method, payload, expected_error in (
            ("GET", {}, "must not have a payload"),
            ("POST", None, "must have an object payload"),
            ("POST", [], "must have an object payload"),
            ("PATCH", {}, "invalid controller method"),
        ):
            try:
                control_json(
                    "https://hil-control.invalid/api/leases", method=method,
                    token="fixture-token", payload=payload, label="method self-test",
                )
            except GateError as error:
                assert expected_error in str(error)
            else:
                raise AssertionError(f"controller accepted unsafe {method} request shape")
        controller_getaddrinfo = socket.getaddrinfo
        controller_timeout = HTTP_TIMEOUT_S

        def stalled_controller_dns(*_args: Any, **_kwargs: Any) -> list[Any]:
            time.sleep(0.2)
            return []

        socket.getaddrinfo = stalled_controller_dns
        HTTP_TIMEOUT_S = 0.02
        try:
            for method, payload in (("GET", None), ("POST", {})):
                controller_started = time.monotonic()
                try:
                    control_json(
                        "https://hil-control.invalid/api/leases", method=method,
                        token="fixture-token", payload=payload, label="deadline self-test",
                    )
                except GateError as error:
                    assert "deadline" in str(error)
                else:
                    raise AssertionError(
                        f"controller {method} escaped its whole-operation deadline"
                    )
                assert time.monotonic() - controller_started < 0.15
        finally:
            HTTP_TIMEOUT_S = controller_timeout
            socket.getaddrinfo = controller_getaddrinfo
        valid_hil_document = json.loads(hil_path.read_text())
        wrong_channel = json.loads(json.dumps(valid_hil_document))
        wrong_channel["lab"]["channel"] = "dev"
        hil_path.write_text(json.dumps(wrong_channel))
        try:
            load_release_hil_inventory(
                hil_path, policy_path=policy_path, require_root_policy=False,
            )
        except GateError:
            pass
        else:
            raise AssertionError("release-HIL accepted a dev-channel lab")
        missing_identity = json.loads(json.dumps(valid_hil_document))
        missing_identity["lab"]["persistence_paths"].remove("hp.tx")
        hil_path.write_text(json.dumps(missing_identity))
        try:
            load_release_hil_inventory(
                hil_path, policy_path=policy_path, require_root_policy=False,
            )
        except GateError:
            pass
        else:
            raise AssertionError("release-HIL accepted incomplete persistence evidence")
        hil_path.write_text(json.dumps(valid_hil_document))
        status_fixture = {
            "hp": {"rx": 44, "tx": 43}, "profile": {"id": "fixture"},
            "ota": {"channel": "release"},
            "mqtt": {
                "base": "daikin-altherma-esp32/release-hil-canary-0123456789abcdef",
                "base_custom": True,
            },
            "sys": {"stack_min_free_bytes": {
                "httpd": 2048, "poll": 1536, "mqtt": 1280, "weather": 1408,
            }},
        }
        assert persistence_snapshot(
            status_fixture, hil["persistence_paths"], hil["persistence_canaries"],
        )["hp.rx"] == 44
        require_release_hil_channel(status_fixture, hil["channel"])
        try:
            require_release_hil_channel(status_fixture, "dev")
        except GateError:
            pass
        else:
            raise AssertionError("release-HIL accepted the wrong running OTA channel")
        hil_headers = release_hil_request_headers(
            hil["manifest_url"], hil["firmware_base_url"],
        )
        assert set(hil_headers) == HIL_FEED_HEADERS
        offer_fixture = {
            "state": "idle", "available": "1.2.3", "available_sha256": "a" * 64,
            "available_channel": "release",
            "effective_manifest_url": hil["manifest_url"],
            "effective_firmware_base_url": hil["firmware_base_url"],
        }
        require_stress_ota_offer(
            offer_fixture, version="1.2.3", app_sha256="a" * 64, channel="release",
            manifest_url=hil["manifest_url"], firmware_base_url=hil["firmware_base_url"],
        )
        wrong_effective_feed = dict(offer_fixture)
        wrong_effective_feed["effective_manifest_url"] = \
            "https://0bu.github.io/daikin-altherma-esp32/manifest.json"
        try:
            require_stress_ota_offer(
                wrong_effective_feed, version="1.2.3", app_sha256="a" * 64,
                channel="release", manifest_url=hil["manifest_url"],
                firmware_base_url=hil["firmware_base_url"],
            )
        except GateError:
            pass
        else:
            raise AssertionError("release-HIL accepted an offer bound to another OTA feed")
        wiped_fixture = json.loads(json.dumps(status_fixture))
        wiped_fixture["mqtt"] = {"base": "daikin-altherma-esp32", "base_custom": False}
        try:
            persistence_snapshot(
                wiped_fixture, hil["persistence_paths"], hil["persistence_canaries"],
            )
        except GateError:
            pass
        else:
            raise AssertionError("release-HIL accepted an NVS-wipe-shaped default snapshot")
        assert require_stack_evidence(
            status_fixture, hil["required_stack_tasks"], hil["min_stack_free_bytes"],
        )["weather"] == 1408
        transfer_fixture = {
            "heap_min_free_bytes": 32768,
            "heap_min_largest_block_bytes": 24576,
            "ota_stack_min_free_bytes": 1536,
            "saw_done": True,
        }
        require_ota_transfer_evidence(
            "hil.invalid", transfer_fixture, phase="self-test",
            writer_version="2.0.0", writer_elf="candidate",
        )
        transfer_fixture["ota_stack_min_free_bytes"] = 1023
        try:
            require_ota_transfer_evidence(
                "hil.invalid", transfer_fixture, phase="self-test",
                writer_version="2.0.0", writer_elf="candidate",
            )
        except GateError:
            pass
        else:
            raise AssertionError("release-HIL accepted inadequate OTA task stack evidence")
        try:
            require_ota_transfer_evidence(
                "hil.invalid", transfer_fixture, phase="self-test",
                writer_version=LEGACY_RELEASE_VERSION, writer_elf=LEGACY_RELEASE_ELF_ID,
            )
        except GateError:
            pass
        else:
            raise AssertionError("legacy writer accepted a numeric OTA stack below the floor")
        transfer_fixture.pop("ota_stack_min_free_bytes")
        require_ota_transfer_evidence(
            "hil.invalid", transfer_fixture, phase="bench target",
            writer_version=LEGACY_RELEASE_VERSION, writer_elf=LEGACY_RELEASE_ELF_ID,
        )
        for writer_version, writer_elf in (
            ("1.0.2-dev.1", LEGACY_RELEASE_ELF_ID),
            (LEGACY_RELEASE_VERSION, "deadbeef0"),
        ):
            try:
                require_ota_transfer_evidence(
                    "hil.invalid", transfer_fixture, phase="bench target",
                    writer_version=writer_version, writer_elf=writer_elf,
                )
            except GateError:
                pass
            else:
                raise AssertionError(
                    "ordinary bench accepted missing OTA stack evidence from a non-legacy writer"
                )
        try:
            require_ota_transfer_evidence(
                "hil.invalid", transfer_fixture, phase="release-HIL",
                writer_version=LEGACY_RELEASE_VERSION, writer_elf=LEGACY_RELEASE_ELF_ID,
            )
        except GateError:
            pass
        else:
            raise AssertionError("release-HIL reused the ordinary bench legacy exception")
        status_fixture["sys"]["stack_min_free_bytes"]["mqtt"] = 512
        try:
            require_stack_evidence(
                status_fixture, hil["required_stack_tasks"], hil["min_stack_free_bytes"],
            )
        except GateError:
            pass
        else:
            raise AssertionError("release-HIL accepted inadequate stack evidence")
        status_fixture["sys"]["stack_min_free_bytes"]["mqtt"] = 1280
        status_fixture["sys"]["stack_min_free_bytes"]["weather"] = None
        try:
            require_stack_evidence(
                status_fixture, hil["required_stack_tasks"], hil["min_stack_free_bytes"],
            )
        except GateError:
            pass
        else:
            raise AssertionError("release-HIL accepted missing Weather stack evidence")

        lease_id = "fixture-lease-0123456789"
        assert validate_feed_lease(
            {
                "controller_id": "hil-feed-controller", "lease_id": lease_id,
                "active": True, "ttl_s": FEED_LEASE_TTL_S,
                "manifest_url": hil["manifest_url"],
                "firmware_base_url": hil["firmware_base_url"],
            },
            controller_id="hil-feed-controller", expected_id=None, active=True,
            manifest_url=hil["manifest_url"], firmware_base_url=hil["firmware_base_url"],
        ) == lease_id
        for bad_ack in (
            {
                "controller_id": "hil-feed-controller", "lease_id": lease_id,
                "active": True, "ttl_s": FEED_LEASE_TTL_S * 2,
                "manifest_url": hil["manifest_url"],
                "firmware_base_url": hil["firmware_base_url"],
            },
            {
                "controller_id": "production-feed-controller", "lease_id": lease_id,
                "active": True, "ttl_s": FEED_LEASE_TTL_S,
                "manifest_url": hil["manifest_url"],
                "firmware_base_url": hil["firmware_base_url"],
            },
            {
                "controller_id": "hil-feed-controller", "lease_id": lease_id,
                "active": True, "ttl_s": FEED_LEASE_TTL_S,
                "manifest_url": "https://wrong.invalid/manifest.json",
                "firmware_base_url": hil["firmware_base_url"],
            },
        ):
            try:
                validate_feed_lease(
                    bad_ack, controller_id="hil-feed-controller",
                    expected_id=lease_id, active=True,
                    manifest_url=hil["manifest_url"],
                    firmware_base_url=hil["firmware_base_url"],
                )
            except GateError:
                continue
            raise AssertionError("release-HIL accepted an invalid feed-controller acknowledgement")

        power_lab = {
            "power_controller_id": "hil-power-controller",
            "power_outlet": "release-lab",
        }
        assert validate_power_ack(
            {
                "controller_id": "hil-power-controller", "outlet": "release-lab",
                "state": "off", "lease_id": lease_id,
                "auto_on_after_s": POWER_OFF_LEASE_S,
            },
            power_lab, "off", None,
        ) == lease_id
        try:
            validate_power_ack(
                {
                    "controller_id": "production-power-controller", "outlet": "release-lab",
                    "state": "off", "lease_id": lease_id,
                    "auto_on_after_s": POWER_OFF_LEASE_S,
                },
                power_lab, "off", None,
            )
        except GateError:
            pass
        else:
            raise AssertionError("release-HIL accepted the wrong power-controller identity")

        watchdog_id = "fixture-watchdog-0123456789"
        watchdog_armed = {
            "controller_id": "hil-power-controller", "outlet": "release-lab",
            "watchdog_id": watchdog_id, "armed": True,
            "expires_in_s": PENDING_IMAGE_WATCHDOG_TTL_S, "action": "power_cycle",
            "off_duration_s": PENDING_IMAGE_WATCHDOG_OFF_S,
        }
        assert validate_cycle_watchdog_ack(
            watchdog_armed, power_lab, expected_id=None, state="created",
        ) == watchdog_id
        assert validate_cycle_watchdog_ack(
            {**watchdog_armed, "expires_in_s": 42}, power_lab,
            expected_id=watchdog_id, state="armed",
        ) == watchdog_id
        try:
            validate_cycle_watchdog_ack(
                {**watchdog_armed, "expires_in_s": PENDING_IMAGE_WATCHDOG_TTL_S + 1}, power_lab,
                expected_id=watchdog_id, state="armed",
            )
        except GateError:
            pass
        else:
            raise AssertionError("release-HIL accepted a watchdog outside the rollback deadline")

        # An ordinary failure immediately after an accepted OTA write must trigger the external
        # cycle rather than leave PENDING_VERIFY alive until the firmware commits it. A hard process
        # kill before explicit approval is covered by the same non-renewable 80-second lease.
        watchdog_calls: list[str] = []
        original_control_json = globals()["control_json"]

        def fake_watchdog_control(
            url: str, *, method: str, token: str, payload: dict[str, Any] | None, label: str,
        ) -> dict[str, Any]:
            del method, token, payload, label
            watchdog_calls.append(url)
            if url.endswith("/trigger"):
                return {
                    "controller_id": "hil-power-controller", "outlet": "release-lab",
                    "watchdog_id": watchdog_id, "cycle_completed": True,
                    "lease_released": True,
                }
            if url.endswith("/release"):
                return {
                    "controller_id": "hil-power-controller", "outlet": "release-lab",
                    "watchdog_id": watchdog_id, "released": True,
                    "lease_released": True,
                }
            return watchdog_armed

        globals()["control_json"] = fake_watchdog_control
        try:
            try:
                with pending_image_power_watchdog(
                    {**power_lab, "power_base_url": "https://power.invalid/api/"}, "fixture-token",
                ):
                    raise GateError("simulated failure immediately after accepted OTA write")
            except GateError:
                pass
            else:
                raise AssertionError("simulated post-write HIL failure was swallowed")
        finally:
            globals()["control_json"] = original_control_json
        assert any(call.endswith("/trigger") for call in watchdog_calls)
        assert not any(call.endswith("/renew") for call in watchdog_calls)

        watchdog_calls.clear()
        globals()["control_json"] = fake_watchdog_control
        try:
            with pending_image_power_watchdog(
                {**power_lab, "power_base_url": "https://power.invalid/api/"}, "fixture-token",
            ) as (require_watchdog_active, _trigger_watchdog, approve_candidate):
                require_watchdog_active()
                approve_candidate()
        finally:
            globals()["control_json"] = original_control_json
        assert any(call.endswith("/release") for call in watchdog_calls)
        assert not any(call.endswith("/renew") for call in watchdog_calls)

        # The cycle decision must use the firmware's boot-latched IDF image-state evidence: the
        # first install is still pending, whereas the second/cold boot has become explicitly valid.
        original_deadline_request = globals()["request_json_deadline"]
        image_state_responses: list[dict[str, Any]] = []

        def fake_image_state_request(*_args: Any, **_kwargs: Any) -> dict[str, Any]:
            if not image_state_responses:
                raise AssertionError("image-state fixture exhausted")
            return image_state_responses.pop(0)

        globals()["request_json_deadline"] = fake_image_state_request
        fixture_endpoint = ResolvedHttpEndpoint(
            socket.AF_INET, socket.SOCK_STREAM, 0, ("192.0.2.1", 80), "hil.invalid",
        )
        try:
            image_state_responses.append({
                "image_state": "pending_verify", "rollback_pending": True,
            })
            assert wait_for_ota_image_state(
                fixture_endpoint, rollback_pending=True,
            )["image_state"] == "pending_verify"
            image_state_responses.append({"image_state": "valid", "rollback_pending": False})
            assert wait_for_ota_image_state(
                fixture_endpoint, rollback_pending=False,
            )["image_state"] == "valid"
            image_state_responses.append({"image_state": "valid", "rollback_pending": False})
            try:
                wait_for_ota_image_state(fixture_endpoint, rollback_pending=True)
            except GateError:
                pass
            else:
                raise AssertionError("release-HIL accepted an already-committed rollback candidate")
        finally:
            globals()["request_json_deadline"] = original_deadline_request

        # The approval timer must be read only after the compact pending-image witness. The first
        # full status returned by the reboot observer may be several polls older and is not a safe
        # source for the 45-second release-HIL decision.
        install_originals = {
            name: globals()[name]
            for name in (
                "resolve_http_endpoint", "request_status_deadline", "request_json",
                "wait_for_ota_offer", "post_update_once", "wait_for_new_firmware",
                "wait_for_ota_image_state",
            )
        }
        fixture_endpoint = ResolvedHttpEndpoint(
            socket.AF_INET, socket.SOCK_STREAM, 0, ("192.0.2.1", 80), "hil.invalid",
        )

        def release_hil_status(version: str, elf: str, uptime_s: int) -> dict[str, Any]:
            return {
                "version": version, "app_elf_sha256": elf, "uptime_s": uptime_s,
                "wifi": {
                    "mac": fixture_mac, "connected": True, "rolled_back": False,
                },
                "sys": {"safe_mode": False}, "last_crash": None,
                "ota": {"channel": "release"},
            }

        stale_candidate = release_hil_status("2.0.0", "candidate", 1)
        post_witness_candidate = release_hil_status("2.0.0", "candidate", 46)
        identity_resolutions: list[str] = []
        identity_timeouts: list[float] = []

        def fake_identity_resolve(host: str) -> ResolvedHttpEndpoint:
            identity_resolutions.append(host)
            return fixture_endpoint

        def fake_identity_status(
            endpoint: ResolvedHttpEndpoint, *, timeout: float,
        ) -> dict[str, Any]:
            assert endpoint == fixture_endpoint
            identity_timeouts.append(timeout)
            return post_witness_candidate

        globals()["resolve_http_endpoint"] = fake_identity_resolve
        globals()["request_status_deadline"] = fake_identity_status
        globals()["request_json"] = lambda *_args, **_kwargs: (_ for _ in ()).throw(
            AssertionError("wait_for_identity used the unbounded status reader")
        )
        bounded_identity = wait_for_identity(
            "hil.invalid", fixture_mac, "2.0.0", "candidate", timeout_s=1,
        )
        assert bounded_identity is post_witness_candidate
        assert identity_resolutions == ["hil.invalid"]
        assert len(identity_timeouts) == 1 and 0 < identity_timeouts[0] <= HTTP_TIMEOUT_S

        status_responses = [
            release_hil_status("1.0.0", "bootstrap", 300), post_witness_candidate,
        ]

        def fake_status_deadline(
            endpoint: ResolvedHttpEndpoint, *, timeout: float,
        ) -> dict[str, Any]:
            assert endpoint == fixture_endpoint and timeout == HTTP_TIMEOUT_S
            if not status_responses:
                raise AssertionError("release-HIL status fixture exhausted")
            return status_responses.pop(0)

        def fake_wait_for_new_firmware(
            host: str, version: str, elf: str, endpoint: ResolvedHttpEndpoint,
            evidence: dict[str, Any] | None = None,
        ) -> dict[str, Any]:
            assert host == "hil.invalid" and version == "2.0.0" and elf == "candidate"
            assert endpoint == fixture_endpoint and evidence is not None
            evidence.update({
                "heap_min_free_bytes": 32768,
                "heap_min_largest_block_bytes": 24576,
                "ota_stack_min_free_bytes": 1536,
                "saw_done": True,
            })
            return stale_candidate

        globals()["resolve_http_endpoint"] = lambda host: fixture_endpoint
        globals()["request_status_deadline"] = fake_status_deadline
        globals()["wait_for_ota_offer"] = lambda *_args, **_kwargs: 7
        globals()["post_update_once"] = lambda *_args, **_kwargs: 8
        globals()["wait_for_new_firmware"] = fake_wait_for_new_firmware
        globals()["wait_for_ota_image_state"] = lambda *_args, **_kwargs: {
            "image_state": "pending_verify", "rollback_pending": True,
        }
        try:
            timed_status, _timed_transfer = release_hil_install_once(
                host="hil.invalid", mac=fixture_mac,
                current_version="1.0.0", current_elf="bootstrap",
                version="2.0.0", app_sha256=app, elf="candidate", channel="release",
                manifest_url="https://feed.invalid/release/manifest.json",
                firmware_base_url="https://feed.invalid/release/",
            )
            assert timed_status is post_witness_candidate
            assert required_uptime(timed_status, "release-HIL timing fixture") == 46
            assert not status_responses
        finally:
            for name, original in install_originals.items():
                globals()[name] = original

        wrong_feed_policy = json.loads(policy_path.read_text())
        wrong_feed_policy["forbidden_production"]["feed_controller_ids"] = [
            "hil-feed-controller",
        ]
        policy_path.write_text(json.dumps(wrong_feed_policy))
        try:
            load_release_hil_inventory(
                hil_path, policy_path=policy_path, require_root_policy=False,
            )
        except GateError:
            pass
        else:
            raise AssertionError("release-HIL accepted a production-denied feed controller")
        policy_path.write_text(json.dumps({
            "schema_version": 3,
            "authorized_lab": authorized_lab,
            "forbidden_production": {
                "hosts": ["production.invalid"],
                "macs": [production_fixture_mac],
                "feed_controller_ids": ["production-feed-controller"],
                "power_endpoints": [
                    {"controller_id": "production-power-controller", "outlet": "production"},
                ],
            },
        }))

        try:
            validate_feed_lease(
                {
                    "controller_id": "hil-feed-controller", "lease_id": lease_id,
                    "active": False, "manifest_url": hil["manifest_url"],
                    "firmware_base_url": hil["firmware_base_url"],
                },
                controller_id="hil-feed-controller", expected_id=lease_id, active=True,
                manifest_url=hil["manifest_url"],
                firmware_base_url=hil["firmware_base_url"],
            )
        except GateError:
            pass
        else:
            raise AssertionError("release-HIL accepted the wrong feed-lease state")

        overlapping_policy = json.loads(policy_path.read_text())
        overlapping_policy["forbidden_production"]["macs"] = [fixture_mac]
        policy_path.write_text(json.dumps(overlapping_policy))
        try:
            load_release_hil_inventory(
                hil_path, policy_path=policy_path, require_root_policy=False,
            )
        except GateError:
            pass
        else:
            raise AssertionError("release-HIL accepted a lab identity on the production denylist")
        policy_path.write_text(json.dumps({
            "schema_version": 3,
            "authorized_lab": authorized_lab,
            "forbidden_production": {
                "hosts": ["production.invalid"],
                "macs": [production_fixture_mac],
                "feed_controller_ids": ["production-feed-controller"],
                "power_endpoints": [
                    {"controller_id": "production-power-controller", "outlet": "production"},
                ],
            },
        }))
        os.chmod(hil_path, 0o666)
        try:
            load_release_hil_inventory(
                hil_path, policy_path=policy_path, require_root_policy=False,
            )
        except GateError:
            pass
        else:
            raise AssertionError("release-HIL accepted a group/world-writable inventory")

        secure_parent = Path(tmp) / "secure-parent"
        secure_parent.mkdir(mode=0o700)
        secure_document = secure_parent / "policy.json"
        secure_document.write_text("{}")
        os.chmod(secure_document, 0o600)
        symlink_document = secure_parent / "policy-link.json"
        symlink_document.symlink_to(secure_document)
        try:
            load_secure_json(symlink_document, "symlink policy", require_root_owner=False)
        except GateError:
            pass
        else:
            raise AssertionError("secure JSON loader followed a symlink file")
        linked_parent = Path(tmp) / "linked-parent"
        linked_parent.symlink_to(secure_parent, target_is_directory=True)
        try:
            load_secure_json(linked_parent / "policy.json", "linked parent", require_root_owner=False)
        except GateError:
            pass
        else:
            raise AssertionError("secure JSON loader followed a symlink parent")
        os.chmod(secure_parent, 0o777)
        try:
            load_secure_json(secure_document, "writable parent", require_root_owner=False)
        except GateError:
            pass
        else:
            raise AssertionError("secure JSON loader accepted a writable parent")
        os.chmod(secure_parent, 0o700)
        if os.getuid() != 0:
            try:
                load_secure_json(secure_document, "root policy", require_root_owner=True)
            except GateError:
                pass
            else:
                raise AssertionError("root policy accepted a non-root owner")
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
    parser.add_argument("--confirm-release-hil")
    parser.add_argument("--release-hil", action="store_true")
    parser.add_argument("--artifact-manifest", type=Path)
    parser.add_argument("--artifact-app", type=Path)
    parser.add_argument("--install-bench", action="store_true")
    parser.add_argument("--execute", action="store_true")
    parser.add_argument("--self-test", action="store_true", help=argparse.SUPPRESS)
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    if args.self_test:
        self_test()
        return 0
    if args.release_hil:
        if not args.execute or args.confirm_release_hil != RELEASE_HIL_ROLE or \
           args.manifest_url is not None or args.install_bench or \
           args.confirm_bench is not None or args.confirm_production is not None or \
           args.expected_current_version is not None:
            fail(
                "release-HIL requires --execute --release-hil --confirm-release-hil release-hil "
                "and accepts no bench, production or remote-manifest mode"
            )
        required_hil = {
            "--artifact-manifest": args.artifact_manifest,
            "--artifact-app": args.artifact_app,
            "--expected-source-sha": args.expected_source_sha,
            "--expected-version": args.expected_version,
            "--expected-app-sha256": args.expected_app_sha256,
        }
        missing_hil = [name for name, value in required_hil.items() if not value]
        if missing_hil:
            fail(f"missing release-HIL arguments: {', '.join(missing_hil)}")
        result = run_release_hil(
            manifest_path=args.artifact_manifest,
            app_path=args.artifact_app,
            source_sha=args.expected_source_sha,
            version=args.expected_version,
            app_sha256=args.expected_app_sha256,
            power_token=os.environ.get("RELEASE_HIL_POWER_TOKEN", ""),
            feed_token=os.environ.get("RELEASE_HIL_FEED_TOKEN", ""),
        )
        print(json.dumps(result, indent=2, sort_keys=True))
        return 0
    if args.confirm_release_hil is not None or args.artifact_manifest is not None or \
       args.artifact_app is not None:
        fail("release-HIL arguments require --release-hil")
    required = {
        "--manifest-url": args.manifest_url,
        "--expected-source-sha": args.expected_source_sha,
        "--expected-version": args.expected_version,
        "--expected-app-sha256": args.expected_app_sha256,
    }
    missing = [name for name, value in required.items() if not value]
    if missing:
        fail(f"missing required arguments: {', '.join(missing)}")
    manifest_bytes = request_limited_bytes(
        cache_busted(args.manifest_url), "official dev manifest",
        LEGACY_BENCH_RESTORE_MANIFEST_MAX_BYTES,
    )
    manifest = strict_json(manifest_bytes, "official dev manifest")
    if not isinstance(manifest, dict):
        fail("manifest is not a JSON object")
    app_url = validate_manifest(
        args.manifest_url, manifest, args.expected_source_sha, args.expected_version,
        args.expected_app_sha256,
    )
    require_legacy_bench_restore_manifest(manifest_bytes, manifest)
    manifest_sha256 = hashlib.sha256(manifest_bytes).hexdigest()
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

    release_manifest_bytes = request_limited_bytes(
        cache_busted(OFFICIAL_RELEASE_MANIFEST_URL), "official release manifest",
        LEGACY_BENCH_RESTORE_MANIFEST_MAX_BYTES,
    )
    release_manifest = strict_json(release_manifest_bytes, "official release manifest")
    if not isinstance(release_manifest, dict):
        fail("official release manifest is not a JSON object")
    release_version, release_sha256, release_url, release_source_sha = validate_release_manifest(
        OFFICIAL_RELEASE_MANIFEST_URL, release_manifest,
    )
    verify_release_source_binding(release_version, release_source_sha, release_sha256)
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
        target_source_sha=args.expected_source_sha, target_version=args.expected_version,
        target_sha256=args.expected_app_sha256, target_manifest_sha256=manifest_sha256,
        target_elf=elf, release_version=release_version, release_sha256=release_sha256,
        release_elf=release_elf,
    )
    test_before = request_json(bench["host"], "/status")
    validate_identity(test_before, host=bench["host"], mac=bench["mac"], version=args.expected_version, elf=elf)
    if required_uptime(test_before, "bench pre-stress status") > MAX_TEST_START_UPTIME_S:
        fail("bench must be freshly booted into the exact artifact so the stress overlaps first TLS activity")
    test_evidence = stress_board(
        host=bench["host"], mac=bench["mac"], version=args.expected_version, elf=elf,
        require_x10a=False, require_weather=False,
        expected_app_sha256=args.expected_app_sha256, expected_channel="dev",
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
    production_before = request_status_deadline(
        production_status_endpoint, timeout=HTTP_TIMEOUT_S,
    )
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
        production_status_endpoint, args.expected_version, args.expected_app_sha256,
    )
    post_update_once(
        production_status_endpoint, check_generation,
        args.expected_version, args.expected_app_sha256,
    )
    returned = wait_for_new_firmware(
        production["host"], args.expected_version, elf, production_status_endpoint,
    )
    validate_identity(returned, host=production["host"], mac=production["mac"], version=args.expected_version, elf=elf)
    production_evidence = stress_board(
        host=production["host"], mac=production["mac"], version=args.expected_version, elf=elf,
        require_x10a=True, require_weather=True,
        expected_app_sha256=args.expected_app_sha256, expected_channel="dev",
    )
    final_status_endpoint = resolve_http_endpoint(production["host"])
    final_status = request_status_deadline(final_status_endpoint, timeout=HTTP_TIMEOUT_S)
    validate_identity(
        final_status, host=production["host"], mac=production["mac"],
        version=args.expected_version, elf=elf,
    )
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
