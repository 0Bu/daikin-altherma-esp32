#!/usr/bin/env python3
"""Mutation canaries for the ESP-IDF feature-matrix audit."""

from __future__ import annotations

import pathlib
import shutil
import subprocess
import sys
import tempfile
from collections.abc import Callable


ROOT = pathlib.Path(__file__).resolve().parents[2]
CHECKER = ROOT / "tools/esp_idf_matrix/check_matrix.py"


def replace_once(path: pathlib.Path, old: str, new: str) -> None:
    text = path.read_text(encoding="utf-8")
    if text.count(old) < 1:
        raise RuntimeError(f"selftest mutation anchor is missing in {path}: {old!r}")
    path.write_text(text.replace(old, new, 1), encoding="utf-8")


def copy_fixture(destination: pathlib.Path) -> None:
    if destination.exists():
        shutil.rmtree(destination)
    destination.mkdir(parents=True)
    shutil.copytree(ROOT / "docs", destination / "docs")
    shutil.copytree(ROOT / "main", destination / "main")
    # Matrix evidence may intentionally point at first-party release/build gates as well as firmware
    # sources. Keep the clean fixture representative so a new valid scripts/ link does not make the
    # mutation canary fail for an unrelated missing-fixture reason.
    shutil.copytree(ROOT / "scripts", destination / "scripts")
    for name in ("CMakeLists.txt", "dependencies.lock", "partitions.csv", "sdkconfig.defaults"):
        shutil.copy2(ROOT / name, destination / name)


def run_checker(fixture: pathlib.Path) -> tuple[int, str]:
    result = subprocess.run(
        [sys.executable, str(CHECKER), "--root", str(fixture)],
        check=False,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
    )
    return result.returncode, result.stdout


def main() -> int:
    with tempfile.TemporaryDirectory(prefix="esp-idf-matrix-selftest-") as temporary:
        work = pathlib.Path(temporary)
        fixture = work / "fixture"
        passed = 0
        failed = 0

        def run_case(
            name: str,
            mutation: Callable[[pathlib.Path], None] | None,
            expected_rc: int,
            needle: str,
        ) -> None:
            nonlocal passed, failed
            copy_fixture(fixture)
            if mutation is not None:
                mutation(fixture)
            actual_rc, output = run_checker(fixture)
            if actual_rc != expected_rc or needle not in output:
                print(
                    f"  FAIL  {name}: expected exit {expected_rc} containing {needle!r}, "
                    f"got {actual_rc}\n{output}",
                    file=sys.stderr,
                )
                failed += 1
                return
            print(f"  PASS  {name}")
            passed += 1

        print("ESP-IDF matrix audit selftest")
        run_case("clean fixture", None, 0, "ESP-IDF matrix audit: PASS")

        run_case(
            "documented component removed",
            lambda root: replace_once(root / "docs/ESP_IDF_MATRIX.md", "`nvs_flash`", "`nvs_flash_missing`"),
            1,
            "explicit component nvs_flash appears 0 times",
        )
        run_case(
            "new CMake component is undocumented",
            lambda root: replace_once(
                root / "main/CMakeLists.txt",
                "        espcoredump\n",
                "        esp_canary\n        espcoredump\n",
            ),
            1,
            "explicit component esp_canary appears 0 times",
        )
        run_case(
            "new private CMake component is undocumented",
            lambda root: replace_once(
                root / "main/CMakeLists.txt",
                "    REQUIRES\n",
                "    PRIV_REQUIRES\n        wear_levelling\n    REQUIRES\n",
            ),
            1,
            "explicit component wear_levelling appears 0 times",
        )
        run_case(
            "new managed dependency is undocumented",
            lambda root: replace_once(
                root / "main/idf_component.yml",
                '  espressif/mdns: "^1.2.0"\n',
                '  espressif/canary: "^1.0.0"\n  espressif/mdns: "^1.2.0"\n',
            ),
            1,
            "manifest direct dependencies do not match",
        )
        run_case(
            "IDF lock version drift",
            lambda root: replace_once(root / "dependencies.lock", "    version: 6.0.2\n", "    version: 6.0.3\n"),
            1,
            "matrix IDF version 6.0.2 differs from lock version 6.0.3",
        )

        def add_sdkconfig(root: pathlib.Path) -> None:
            path = root / "sdkconfig.defaults"
            path.write_text(path.read_text(encoding="utf-8") + "\nCONFIG_MATRIX_CANARY=y\n", encoding="utf-8")

        run_case(
            "new sdkconfig assignment is undocumented",
            add_sdkconfig,
            1,
            "active sdkconfig assignment CONFIG_MATRIX_CANARY=y is missing",
        )

        def add_unknown_header(root: pathlib.Path) -> None:
            path = root / "main/main.cpp"
            path.write_text('#include "esp_matrix_canary.h"\n' + path.read_text(encoding="utf-8"), encoding="utf-8")

        run_case(
            "new IDF header is unclassified",
            add_unknown_header,
            1,
            "unclassified ESP-IDF header esp_matrix_canary.h",
        )

        def duplicate_row(root: pathlib.Path) -> None:
            path = root / "docs/ESP_IDF_MATRIX.md"
            text = path.read_text(encoding="utf-8")
            row = next(line for line in text.splitlines() if line.startswith("| U05 |"))
            replace_once(path, row, f"{row}\n{row}")

        run_case("duplicate stable row ID", duplicate_row, 1, "duplicate matrix row ID U05")

        def remove_evaluated_row(root: pathlib.Path) -> None:
            path = root / "docs/ESP_IDF_MATRIX.md"
            lines = path.read_text(encoding="utf-8").splitlines()
            matching = [line for line in lines if line.startswith("| N10 |")]
            if len(matching) != 1:
                raise RuntimeError("selftest mutation anchor for N10 is missing or duplicated")
            path.write_text(
                "\n".join(line for line in lines if not line.startswith("| N10 |")) + "\n",
                encoding="utf-8",
            )

        run_case(
            "curated ESP-DL decision row removed",
            remove_evaluated_row,
            1,
            "required evaluated row N10 (ESP-DL) is missing",
        )
        run_case(
            "broken local evidence link",
            lambda root: replace_once(
                root / "docs/ESP_IDF_MATRIX.md",
                "../main/nvs_storage.cpp",
                "../main/nvs_storage_missing.cpp",
            ),
            1,
            "local evidence target does not exist",
        )
        run_case(
            "non-Espressif documentation link",
            lambda root: replace_once(
                root / "docs/ESP_IDF_MATRIX.md",
                "https://github.com/espressif/esp-matter",
                "https://github.com/example/esp-matter",
            ),
            1,
            "non-Espressif documentation link",
        )
        run_case(
            "ESP-IDF documentation link loses version pin",
            lambda root: replace_once(
                root / "docs/ESP_IDF_MATRIX.md",
                "/projects/esp-idf/en/v6.0.2/esp32s3/api-guides/build-system.html",
                "/projects/esp-idf/en/stable/esp32s3/api-guides/build-system.html",
            ),
            1,
            "ESP-IDF documentation link is not pinned to matrix IDF 6.0.2/esp32s3",
        )

        def add_https_ota_call(root: pathlib.Path) -> None:
            path = root / "main/ota_update.cpp"
            path.write_text(
                path.read_text(encoding="utf-8")
                + "\nvoid esp_idf_matrix_canary() { esp_https_ota_begin(nullptr, nullptr); }\n",
                encoding="utf-8",
            )

        run_case(
            "manual OTA boundary changes",
            add_https_ota_call,
            1,
            "esp_https_ota is now called",
        )

        def add_https_ota_oneshot_call(root: pathlib.Path) -> None:
            path = root / "main/ota_update.cpp"
            path.write_text(
                path.read_text(encoding="utf-8")
                + "\nvoid esp_idf_matrix_oneshot_canary() { esp_https_ota(nullptr); }\n",
                encoding="utf-8",
            )

        run_case(
            "one-shot ESP HTTPS OTA adoption changes the decision row",
            add_https_ota_oneshot_call,
            1,
            "esp_https_ota is now called",
        )

        def append_call(root: pathlib.Path, call: str) -> None:
            path = root / "main/main.cpp"
            path.write_text(
                path.read_text(encoding="utf-8") + f"\nvoid esp_idf_matrix_call_canary() {{ {call}; }}\n",
                encoding="utf-8",
            )

        run_case(
            "ESP-Modbus adoption changes the decision row",
            lambda root: append_call(root, "esp_modbus_master_start()"),
            1,
            "ESP-Modbus is now called",
        )
        run_case(
            "native provisioning adoption changes the decision row",
            lambda root: append_call(root, "network_prov_mgr_start_provisioning()"),
            1,
            "native provisioning is now called",
        )
        run_case(
            "custom captive DNS boundary disappears",
            lambda root: replace_once(root / "main/captive_dns.cpp", "::recvfrom(", "::recvfrom_missing("),
            1,
            "captive DNS no longer calls recvfrom",
        )
        run_case(
            "raw RMT adoption changes the backend row",
            lambda root: append_call(root, "rmt_transmit()"),
            1,
            "application now calls raw RMT APIs",
        )
        run_case(
            "vacuous used-table parser",
            lambda root: replace_once(
                root / "docs/ESP_IDF_MATRIX.md",
                "<!-- esp-idf-matrix:used:start -->",
                "<!-- used-table-marker-removed -->",
            ),
            2,
            "must have exactly one start and end marker",
        )

        if failed:
            print(f"selftest FAILED: {failed} mutation(s) escaped; {passed} passed", file=sys.stderr)
            return 1
        print(f"selftest ok: {passed} clean/mutated cases behaved as expected")
        return 0


if __name__ == "__main__":
    sys.exit(main())
