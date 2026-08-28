#!/usr/bin/env python3
"""Fail closed when docs/ESP_IDF_MATRIX.md drifts from the ESP-IDF surface."""

from __future__ import annotations

import argparse
import fnmatch
import json
import pathlib
import re
import sys
import urllib.parse


class MatrixFormatError(ValueError):
    """The document or one of its authoritative inputs cannot be parsed safely."""


USED_STATUSES = {
    "✅ Direct",
    "🧩 Backend",
    "📦 Managed",
    "✅ Direct + 📦 Managed",
    "✅ Direct + 🧩 Backend",
    "🧩 Backend + 📦 Managed",
    "✅ Direct + 🧩 Backend + 📦 Managed",
}
EVALUATED_STATUSES = {"🔬 Evaluate", "⏸ Conditional", "🚫 Not planned", "⛔ Unsupported"}
REQUIRED_EVALUATED_FEATURES = {
    "N01": "ESP-Modbus TCP master",
    "N02": "Network Provisioning and Protocomm",
    "N03": "HMAC-backed NVS encryption",
    "N04": "ESP Wi-Fi Service",
    "N05": "ESP Config Manager",
    "N06": "`esp_https_ota` convenience layer",
    "N07": "HTTPS server",
    "N08": "Hardware Secure Boot v2 and Flash Encryption",
    "N09": "FATFS, SPIFFS, LittleFS and Wear Levelling",
    "N10": "ESP-DL",
    "N11": "ESP-DSP",
    "N12": "NimBLE and Bluetooth LE",
    "N13": "ESP-Matter",
    "N14": "ESP Insights, ESP Diagnostics and RainMaker",
    "N15": "ESP-NOW, Wi-Fi Mesh, DPP and SmartConfig",
    "N16": "PSRAM",
    "N17": "Heap tracing, Application Trace, GDB Stub and ESP Console",
    "N18": "HTTP WebSockets",
    "N19": "Power management, sleep modes and ULP",
    "N20": "USB OTG, TinyUSB and DFU",
    "N21": "OpenThread and Zigbee",
    "N22": "SDMMC, TWAI, I2S, LCD/camera, ADC/touch, MCPWM and PCNT",
    "N23": "ESP-WHO and ESP-SR",
    "N24": "Bluetooth Classic",
    "N25": "Internal Ethernet EMAC",
}
OFFICIAL_HOSTS = {
    "components.espressif.com",
    "docs.espressif.com",
    "github.com",
    "www.espressif.com",
}
SOURCE_SUFFIXES = {".c", ".cc", ".cpp", ".h", ".hh", ".hpp"}

# Header-to-row mapping is intentionally explicit. Component names, header names and capabilities
# are not interchangeable in ESP-IDF (for example esp_crt_bundle.h belongs below Mbed TLS, and PSA
# Crypto is supplied through the mbedtls component). A new IDF-shaped include must be adjudicated
# here and in the document instead of being guessed from its filename.
HEADER_ROWS = (
    ("sdkconfig.h", "U01"),
    ("soc/soc_caps.h", "U01"),
    ("freertos/*", "U02"),
    ("esp_attr.h", "U03"),
    ("esp_err.h", "U03"),
    ("esp_heap_caps.h", "U03"),
    ("esp_log.h", "U03"),
    ("esp_mac.h", "U03"),
    ("esp_system.h", "U03"),
    ("esp_task_wdt.h", "U04"),
    ("esp_timer.h", "U04"),
    ("nvs.h", "U05"),
    ("nvs_flash.h", "U05"),
    ("esp_partition.h", "U06"),
    ("esp_core_dump.h", "U07"),
    ("esp_wifi.h", "U08"),
    ("esp_event.h", "U09"),
    ("esp_netif_sntp.h", "U10"),
    ("esp_netif*", "U09"),
    ("lwip/*", "U10"),
    ("ping/*", "U10"),
    ("esp_eth*", "U11"),
    ("driver/spi_master.h", "U11"),
    ("esp_http_server.h", "U12"),
    ("esp_crt_bundle.h", "U13"),
    ("esp_http_client.h", "U13"),
    ("esp_tls*", "U13"),
    ("mqtt_client.h", "U14"),
    ("mdns.h", "U15"),
    ("cJSON.h", "U16"),
    ("esp_app_desc.h", "U17"),
    ("esp_app_format.h", "U17"),
    ("esp_ota_ops.h", "U17"),
    ("psa/*", "U18"),
    ("driver/uart.h", "U19"),
    ("driver/i2c_master.h", "U20"),
    ("driver/gpio.h", "U21"),
    ("driver/rmt*.h", "U22"),
    ("led_strip.h", "U22"),
)


def read_text(path: pathlib.Path) -> str:
    try:
        return path.read_text(encoding="utf-8")
    except OSError as error:
        raise MatrixFormatError(f"cannot read {path}: {error}") from error


def marked_section(text: str, name: str) -> str:
    start = f"<!-- esp-idf-matrix:{name}:start -->"
    end = f"<!-- esp-idf-matrix:{name}:end -->"
    if text.count(start) != 1 or text.count(end) != 1:
        raise MatrixFormatError(f"matrix section {name!r} must have exactly one start and end marker")
    before, rest = text.split(start, 1)
    body, after = rest.split(end, 1)
    if len(before) + len(start) >= len(before) + len(start) + len(body):
        raise MatrixFormatError(f"matrix section {name!r} is empty")
    if start in after or end in before:
        raise MatrixFormatError(f"matrix section {name!r} markers are out of order")
    return body


def parse_table(section: str, *, columns: int, name: str) -> list[list[str]]:
    rows: list[list[str]] = []
    for line_no, raw in enumerate(section.splitlines(), 1):
        line = raw.strip()
        if not line.startswith("|"):
            continue
        cells = [cell.strip() for cell in line.strip("|").split("|")]
        if all(re.fullmatch(r":?-+:?", cell) for cell in cells):
            continue
        if cells and cells[0] in {"ID", "Setting"}:
            continue
        if len(cells) != columns:
            raise MatrixFormatError(
                f"{name} table row {line_no} has {len(cells)} columns, expected {columns}"
            )
        rows.append(cells)
    if not rows:
        raise MatrixFormatError(f"{name} table contains no data rows")
    return rows


def code_spans(cell: str) -> list[str]:
    return re.findall(r"`([^`]+)`", cell)


def markdown_links(cell: str) -> list[str]:
    return re.findall(r"\[[^\]]+\]\(([^)]+)\)", cell)


def parse_metadata(text: str) -> dict[str, str]:
    matches = re.findall(r"<!-- esp-idf-matrix:metadata (\{[^\n]+\}) -->", text)
    if len(matches) != 1:
        raise MatrixFormatError("matrix must contain exactly one JSON metadata marker")
    try:
        value = json.loads(matches[0])
    except json.JSONDecodeError as error:
        raise MatrixFormatError(f"invalid matrix metadata JSON: {error}") from error
    if not isinstance(value, dict) or set(value) != {"target", "version", "idf_floor"}:
        raise MatrixFormatError("matrix metadata must contain target, version and idf_floor")
    if not all(isinstance(item, str) and item for item in value.values()):
        raise MatrixFormatError("matrix metadata values must be non-empty strings")
    return value


def documentation_version(version: str) -> str:
    """Return the ESP-IDF documentation channel for an exact resolved release.

    Espressif publishes the 6.1.0 release under ``/v6.1/`` rather than ``/v6.1.0/``. Keep the
    lock/matrix comparison exact, but normalize a patch-zero release for documentation URLs.
    """
    match = re.fullmatch(r"(\d+\.\d+)\.0", version)
    return match.group(1) if match else version


def parse_cmake_component_dependencies(path: pathlib.Path) -> list[str]:
    text = read_text(path)
    match = re.search(r"idf_component_register\s*\((.*?)\)\s*", text, re.DOTALL)
    if not match:
        raise MatrixFormatError("main/CMakeLists.txt has no parseable idf_component_register block")
    block = re.sub(r"#.*", "", match.group(1))
    register_keywords = (
        "SRCS",
        "SRC_DIRS",
        "EXCLUDE_SRCS",
        "INCLUDE_DIRS",
        "PRIV_INCLUDE_DIRS",
        "REQUIRES",
        "PRIV_REQUIRES",
        "LDFRAGMENTS",
        "EMBED_FILES",
        "EMBED_TXTFILES",
        "REQUIRED_IDF_TARGETS",
        "WHOLE_ARCHIVE",
        "KCONFIG",
        "KCONFIG_PROJBUILD",
    )
    keyword_pattern = "|".join(register_keywords)
    sections = re.findall(
        rf"\b(?:REQUIRES|PRIV_REQUIRES)\b(.*?)(?=\b(?:{keyword_pattern})\b|$)",
        block,
        re.DOTALL,
    )
    if not sections:
        raise MatrixFormatError(
            "main/CMakeLists.txt has no parseable REQUIRES or PRIV_REQUIRES block"
        )
    tokens = [
        token
        for section in sections
        for token in re.findall(r"[A-Za-z0-9_.+-]+", section)
    ]
    if not tokens:
        raise MatrixFormatError("main/CMakeLists.txt component dependency blocks are empty")
    if len(tokens) != len(set(tokens)):
        raise MatrixFormatError("main/CMakeLists.txt contains duplicate component dependencies")
    return tokens


def unquote_yaml(value: str) -> str:
    value = value.strip()
    if len(value) >= 2 and value[0] == value[-1] and value[0] in {'"', "'"}:
        return value[1:-1]
    return value


def parse_manifest(path: pathlib.Path) -> tuple[str, list[str]]:
    text = read_text(path)
    floor = re.search(r'^  idf:\s*([^\n#]+)', text, re.MULTILINE)
    if not floor:
        raise MatrixFormatError("main/idf_component.yml has no parseable IDF floor")
    dependencies = re.findall(r"^  (espressif/[A-Za-z0-9_.-]+):", text, re.MULTILINE)
    if not dependencies:
        raise MatrixFormatError("main/idf_component.yml has no direct managed dependencies")
    return unquote_yaml(floor.group(1)), dependencies


def parse_lock(path: pathlib.Path) -> tuple[str, str, list[str]]:
    text = read_text(path)
    target = re.search(r"^target:\s*([^\s#]+)", text, re.MULTILINE)
    idf_block = re.search(r"^  idf:\n((?:^    .*\n)+)", text, re.MULTILINE)
    direct = re.search(r"^direct_dependencies:\n((?:^- .*\n)+)", text, re.MULTILINE)
    if not target or not idf_block or not direct:
        raise MatrixFormatError("dependencies.lock target, IDF block or direct dependencies are missing")
    version = re.search(r"^    version:\s*([^\s#]+)", idf_block.group(1), re.MULTILINE)
    if not version:
        raise MatrixFormatError("dependencies.lock IDF version is missing")
    dependencies = [line[2:].strip() for line in direct.group(1).splitlines()]
    dependencies = [item for item in dependencies if item and item != "idf"]
    if not dependencies:
        raise MatrixFormatError("dependencies.lock has no direct managed dependencies")
    return unquote_yaml(target.group(1)), unquote_yaml(version.group(1)), dependencies


def parse_sdkconfig(path: pathlib.Path) -> dict[str, str]:
    assignments: dict[str, str] = {}
    for line_no, raw in enumerate(read_text(path).splitlines(), 1):
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        if not line.startswith("CONFIG_"):
            continue
        match = re.fullmatch(r"(CONFIG_[A-Za-z0-9_]+)=(.*)", line)
        if not match:
            raise MatrixFormatError(f"sdkconfig.defaults:{line_no}: malformed CONFIG assignment")
        key, value = match.groups()
        if key in assignments:
            raise MatrixFormatError(f"sdkconfig.defaults:{line_no}: duplicate assignment for {key}")
        assignments[key] = value
    if not assignments:
        raise MatrixFormatError("sdkconfig.defaults contains no active assignments")
    return assignments


def idf_shaped_header(header: str) -> bool:
    return (
        header.startswith(("driver/", "esp_", "freertos/", "lwip/", "nvs", "ping/", "psa/", "soc/"))
        or header in {"cJSON.h", "led_strip.h", "mdns.h", "mqtt_client.h", "sdkconfig.h"}
    )


def classify_header(header: str) -> str | None:
    # Specific patterns precede broad families (esp_netif_sntp.h before esp_netif*). First match is
    # therefore intentional and lets one capability be documented more narrowly than its provider.
    for pattern, row in HEADER_ROWS:
        if fnmatch.fnmatchcase(header, pattern):
            return row
    return None


def scan_headers(root: pathlib.Path) -> dict[str, set[pathlib.Path]]:
    found: dict[str, set[pathlib.Path]] = {}
    main = root / "main"
    if not main.is_dir():
        raise MatrixFormatError("main source directory is missing")
    for path in main.rglob("*"):
        if not path.is_file() or path.suffix not in SOURCE_SUFFIXES:
            continue
        for header in re.findall(r'^\s*#\s*include\s*[<"]([^>"]+)[>"]', read_text(path), re.MULTILINE):
            # A project header can legitimately start with an IDF-looking prefix (nvs_storage.hpp).
            # Component-local includes resolve from main/ before ESP-IDF include directories.
            if (main / header).exists():
                continue
            if idf_shaped_header(header):
                found.setdefault(header, set()).add(path.relative_to(root))
    if not found:
        raise MatrixFormatError("no ESP-IDF-shaped application includes were found")
    return found


def strip_cpp_comments(text: str) -> str:
    text = re.sub(r"/\*.*?\*/", "", text, flags=re.DOTALL)
    return re.sub(r"//[^\n]*", "", text)


def validate_manual_boundaries(root: pathlib.Path, findings: list[str]) -> None:
    application = "\n".join(
        strip_cpp_comments(read_text(path))
        for path in (root / "main").rglob("*")
        if path.is_file() and path.suffix in SOURCE_SUFFIXES
    )
    ota = strip_cpp_comments(read_text(root / "main/ota_update.cpp"))
    for call in ("esp_http_client_init", "esp_ota_begin", "esp_ota_write", "esp_ota_end"):
        if not re.search(rf"\b{call}\s*\(", ota):
            findings.append(f"manual/native boundary changed: OTA no longer calls {call}")
    if re.search(r"\besp_https_ota(?:_[A-Za-z0-9_]+)?\s*\(", application):
        findings.append("manual/native boundary changed: esp_https_ota is now called but N06 is not promoted")

    modbus = strip_cpp_comments(read_text(root / "main/hp_modbus.cpp"))
    for call in ("socket", "recv", "send"):
        if not re.search(rf"\b{call}\s*\(", modbus):
            findings.append(f"manual/native boundary changed: custom Modbus path no longer calls {call}")
    if re.search(r"\b(?:mbc_|esp_modbus_)[A-Za-z0-9_]*\s*\(", application):
        findings.append("manual/native boundary changed: ESP-Modbus is now called but N01 is not promoted")

    captive = strip_cpp_comments(read_text(root / "main/captive_dns.cpp"))
    for call in ("socket", "recvfrom", "sendto"):
        if not re.search(rf"\b{call}\s*\(", captive):
            findings.append(f"manual/native boundary changed: captive DNS no longer calls {call}")
    if re.search(
        r"\b(?:network_prov_mgr_|wifi_prov_mgr_|network_provisioning_|wifi_provisioning_)"
        r"[A-Za-z0-9_]*\s*\(",
        application,
    ):
        findings.append("manual/native boundary changed: native provisioning is now called but N02 is not promoted")

    led = strip_cpp_comments(read_text(root / "main/status_led.cpp"))
    if not re.search(r"\bled_strip_new_rmt_device\s*\(", led):
        findings.append("manual/native boundary changed: RMT LED backend is no longer created through led_strip")
    if re.search(r"\brmt_(?:new_tx_channel|enable|transmit|disable|del_channel)\s*\(", application):
        findings.append("manual/native boundary changed: application now calls raw RMT APIs; review U22")


def validate(root: pathlib.Path) -> tuple[list[str], dict[str, int]]:
    matrix_path = root / "docs/ESP_IDF_MATRIX.md"
    text = read_text(matrix_path)
    metadata = parse_metadata(text)
    used = parse_table(marked_section(text, "used"), columns=7, name="used")
    evaluated = parse_table(marked_section(text, "evaluated"), columns=7, name="evaluated")
    config_rows = parse_table(marked_section(text, "sdkconfig"), columns=3, name="sdkconfig")
    docs_version = documentation_version(metadata["version"])

    findings: list[str] = []
    for required_index in (
        "https://docs.espressif.com/projects/esp-idf/en/stable/esp32/get-started/index.html",
        f"https://docs.espressif.com/projects/esp-idf/en/v{docs_version}/"
        f"{metadata['target']}/api-reference/index.html",
    ):
        if required_index not in text:
            findings.append(f"matrix is missing required documentation index {required_index}")
    all_rows = used + evaluated
    row_ids: dict[str, list[str]] = {}
    for row in all_rows:
        row_ids.setdefault(row[0], []).append(row[1])
    for row_id, names in row_ids.items():
        if len(names) != 1:
            findings.append(f"duplicate matrix row ID {row_id}: {names}")
    for row in used:
        if not re.fullmatch(r"U\d{2}", row[0]):
            findings.append(f"used row has invalid ID {row[0]!r}")
        if row[2] not in USED_STATUSES:
            findings.append(f"used row {row[0]} has invalid status {row[2]!r}")
    for row in evaluated:
        if not re.fullmatch(r"N\d{2}", row[0]):
            findings.append(f"evaluated row has invalid ID {row[0]!r}")
        if row[2] not in EVALUATED_STATUSES:
            findings.append(f"evaluated row {row[0]} has invalid status {row[2]!r}")
    evaluated_features = {row[0]: row[1] for row in evaluated}
    for row_id, feature in REQUIRED_EVALUATED_FEATURES.items():
        actual = evaluated_features.get(row_id)
        if actual is None:
            findings.append(f"required evaluated row {row_id} ({feature}) is missing")
        elif actual != feature:
            findings.append(
                f"required evaluated row {row_id} must remain {feature!r}, got {actual!r}"
            )

    docs_dir = matrix_path.parent
    for row in all_rows:
        evidence_links = markdown_links(row[5])
        if not evidence_links:
            findings.append(f"matrix row {row[0]} has no local evidence link")
        for target in evidence_links:
            parsed = urllib.parse.urlparse(target)
            if parsed.scheme or parsed.netloc:
                findings.append(f"matrix row {row[0]} evidence must be local, got {target}")
                continue
            relative = urllib.parse.unquote(parsed.path)
            resolved = (docs_dir / relative).resolve()
            try:
                resolved.relative_to(root.resolve())
            except ValueError:
                findings.append(f"matrix row {row[0]} evidence escapes the repository: {target}")
                continue
            if not resolved.exists():
                findings.append(f"matrix row {row[0]} local evidence target does not exist: {target}")

        official_links = markdown_links(row[6])
        if not official_links:
            findings.append(f"matrix row {row[0]} has no official documentation link")
        for target in official_links:
            parsed = urllib.parse.urlparse(target)
            official = parsed.scheme == "https" and parsed.hostname in OFFICIAL_HOSTS
            if parsed.hostname == "github.com" and not parsed.path.startswith("/espressif/"):
                official = False
            if not official:
                findings.append(f"matrix row {row[0]} has a non-Espressif documentation link: {target}")
            elif parsed.hostname == "docs.espressif.com" and parsed.path.startswith(
                "/projects/esp-idf/"
            ):
                expected_prefix = (
                    f"/projects/esp-idf/en/v{docs_version}/{metadata['target']}/"
                )
                if not parsed.path.startswith(expected_prefix):
                    findings.append(
                        f"matrix row {row[0]} ESP-IDF documentation link is not pinned to "
                        f"matrix IDF documentation series {docs_version}/{metadata['target']}: "
                        f"{target}"
                    )

    used_ids = {row[0] for row in used}
    source_tokens = [token for row in used for token in code_spans(row[3])]
    cmake_components = parse_cmake_component_dependencies(root / "main/CMakeLists.txt")
    manifest_floor, manifest_dependencies = parse_manifest(root / "main/idf_component.yml")
    lock_target, lock_version, lock_dependencies = parse_lock(root / "dependencies.lock")

    if len(manifest_dependencies) != len(set(manifest_dependencies)):
        raise MatrixFormatError("main/idf_component.yml contains duplicate direct dependencies")
    if sorted(manifest_dependencies) != sorted(lock_dependencies):
        findings.append(
            "manifest direct dependencies do not match dependencies.lock: "
            f"manifest={manifest_dependencies}, lock={lock_dependencies}"
        )
    for component in cmake_components:
        count = source_tokens.count(component)
        if count != 1:
            findings.append(f"explicit component {component} appears {count} times in used component/source cells")
    for dependency in manifest_dependencies:
        count = source_tokens.count(dependency)
        if count != 1:
            findings.append(f"managed dependency {dependency} appears {count} times in used component/source cells")
    known_source_tokens = set(cmake_components) | set(manifest_dependencies)
    for token in sorted(set(source_tokens) - known_source_tokens):
        findings.append(f"used component/source token {token} is not an explicit or direct managed dependency")

    if metadata["target"] != lock_target:
        findings.append(f"matrix target {metadata['target']} differs from lock target {lock_target}")
    if metadata["version"] != lock_version:
        findings.append(f"matrix IDF version {metadata['version']} differs from lock version {lock_version}")
    if metadata["idf_floor"] != manifest_floor:
        findings.append(f"matrix IDF floor {metadata['idf_floor']} differs from manifest floor {manifest_floor}")

    documented_config: dict[str, tuple[str, str]] = {}
    for row in config_rows:
        keys = code_spans(row[0])
        values = code_spans(row[1])
        if len(keys) != 1 or len(values) != 1:
            raise MatrixFormatError("sdkconfig table rows must contain one code-wrapped setting and value")
        key, value, feature_id = keys[0], values[0], row[2]
        if key in documented_config:
            findings.append(f"duplicate sdkconfig matrix setting {key}")
        documented_config[key] = (value, feature_id)
        if feature_id not in used_ids:
            findings.append(f"sdkconfig setting {key} points to non-used feature row {feature_id}")
    actual_config = parse_sdkconfig(root / "sdkconfig.defaults")
    for key, value in actual_config.items():
        documented = documented_config.get(key)
        if documented is None:
            findings.append(f"active sdkconfig assignment {key}={value} is missing from the matrix")
        elif documented[0] != value:
            findings.append(f"sdkconfig matrix has {key}={documented[0]}, expected {value}")
    for key in sorted(set(documented_config) - set(actual_config)):
        findings.append(f"sdkconfig matrix documents inactive or removed setting {key}")

    headers = scan_headers(root)
    for header, paths in sorted(headers.items()):
        row_id = classify_header(header)
        if row_id is None:
            findings.append(
                f"unclassified ESP-IDF header {header} included by "
                + ", ".join(str(path) for path in sorted(paths))
            )
        elif row_id not in used_ids:
            findings.append(f"ESP-IDF header {header} maps to missing used feature row {row_id}")

    validate_manual_boundaries(root, findings)
    return findings, {
        "used": len(used),
        "evaluated": len(evaluated),
        "components": len(cmake_components),
        "managed": len(manifest_dependencies),
        "config": len(actual_config),
        "headers": len(headers),
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=pathlib.Path, default=pathlib.Path(__file__).resolve().parents[2])
    args = parser.parse_args()
    root = args.root.resolve()
    try:
        findings, counts = validate(root)
    except MatrixFormatError as error:
        print(f"ESP-IDF matrix audit could not establish its inputs: {error}", file=sys.stderr)
        return 2
    if findings:
        print(f"ESP-IDF matrix audit: {len(findings)} finding(s):", file=sys.stderr)
        for finding in findings:
            print(f"  - {finding}", file=sys.stderr)
        return 1
    print(
        "ESP-IDF matrix audit: PASS "
        f"({counts['used']} used, {counts['evaluated']} evaluated, "
        f"{counts['components']} explicit components, {counts['managed']} managed dependencies, "
        f"{counts['config']} sdkconfig assignments, {counts['headers']} IDF headers)"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
