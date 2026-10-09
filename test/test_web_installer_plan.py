#!/usr/bin/env python3
"""Positive and negative controls for the complete official Web Serial publication plan."""

from __future__ import annotations

import hashlib
import json
import subprocess
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
CHECKER = ROOT / "scripts" / "check-web-installer-plan.py"
APP_NAME = "daikin-altherma-esp32.bin"
PARTS = [
    ("daikin-altherma-esp32-web-bootloader.bin", 0, 0x6000),
    ("daikin-altherma-esp32-web-partition-table.bin", 0x8000, 0xc00),
    ("daikin-altherma-esp32-web-ota_data_initial.bin", 0xf000, 0x2000),
    (APP_NAME, 0x20000, 0x21000),
]


class WebInstallerPlanTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        self.partitions = self.root / "partitions.csv"
        self.partitions.write_text((ROOT / "partitions.csv").read_text(encoding="utf-8"), encoding="utf-8")
        for index, (name, _, size) in enumerate(PARTS):
            (self.root / name).write_bytes(bytes([0xa5 + index]) * size)
        self.manifest = self.root / "manifest.json"
        self.index_path = self.root / "artifacts.json"
        self.document = {
            "name": "daikin-altherma-esp32",
            "version": "1.2.3",
            "provenance": {"app_sha256": self.digest(self.root / APP_NAME)},
            "new_install_prompt_erase": True,
            "builds": [{"chipFamily": "ESP32-S3", "parts": [
                {"path": name, "offset": offset} for name, offset, _ in PARTS
            ]}],
        }
        self.write_metadata()

    def tearDown(self) -> None:
        self.tmp.cleanup()

    @staticmethod
    def digest(path: Path) -> str:
        return hashlib.sha256(path.read_bytes()).hexdigest()

    def write_metadata(self) -> None:
        self.manifest.write_text(json.dumps(self.document), encoding="utf-8")
        self.index = {
            "schema_version": 1,
            "manifest_sha256": self.digest(self.manifest),
            "artifacts": [
                {"path": path.name, "size": path.stat().st_size, "sha256": self.digest(path)}
                for path in sorted(self.root.glob("*.bin"))
            ],
        }
        self.write_index()

    def write_index(self) -> None:
        self.index_path.write_text(json.dumps(self.index), encoding="utf-8")

    def run_checker(self) -> subprocess.CompletedProcess[str]:
        return subprocess.run(
            [str(CHECKER), str(self.manifest), str(self.partitions)],
            text=True, capture_output=True, check=False,
        )

    def assert_rejected(self, message: str) -> None:
        result = self.run_checker()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn(message, result.stderr)
        self.assertNotIn("Traceback", result.stderr)

    def test_accepts_complete_canonical_plan_bound_to_application_hash(self) -> None:
        result = self.run_checker()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("4 indexed canonical ESP32-S3 parts checked", result.stdout)
        self.assertIn("nvs@0x9000-0xefff is untouched", result.stdout)
        self.assertIn("coredump and history are untouched", result.stdout)

    def test_rejects_unsupported_target(self) -> None:
        self.document["builds"][0]["chipFamily"] = "ESP32-C3"
        self.write_metadata()
        self.assert_rejected("supports only ESP32-S3")

    def test_rejects_wrong_offset_even_when_it_misses_nvs(self) -> None:
        self.document["builds"][0]["parts"][3]["offset"] = 0x210000
        self.write_metadata()
        self.assert_rejected("must use canonical offset 0x20000")

    def test_rejects_substituted_bootloader_with_valid_inventory_hash(self) -> None:
        (self.root / "replacement.bin").write_bytes((self.root / PARTS[0][0]).read_bytes())
        self.document["builds"][0]["parts"][0]["path"] = "replacement.bin"
        self.write_metadata()
        self.assert_rejected("noncanonical or duplicate")

    def test_rejects_singleton_or_missing_application(self) -> None:
        self.document["builds"][0]["parts"] = [{"path": APP_NAME, "offset": 0x20000}]
        self.write_metadata()
        self.assert_rejected("complete four-part canonical flash plan")

    def test_rejects_duplicate_parts_and_targets(self) -> None:
        self.document["builds"][0]["parts"][3] = dict(self.document["builds"][0]["parts"][0])
        self.write_metadata()
        self.assert_rejected("noncanonical or duplicate")
        self.document["builds"][0]["parts"] = [{"path": name, "offset": offset} for name, offset, _ in PARTS]
        self.document["builds"].append(dict(self.document["builds"][0]))
        self.write_metadata()
        self.assert_rejected("repeats a build target")

    def test_rejects_unindexed_part_and_duplicate_artifact(self) -> None:
        self.index["artifacts"] = [entry for entry in self.index["artifacts"] if entry["path"] != APP_NAME]
        self.write_index()
        self.assert_rejected("missing from artifact index")
        self.write_metadata()
        self.index["artifacts"].append(dict(self.index["artifacts"][0]))
        self.write_index()
        self.assert_rejected("path is unsafe or duplicate")

    def test_rejects_erase_sector_overlap_at_bootloader_boundary(self) -> None:
        (self.root / PARTS[0][0]).write_bytes(b"x" * 0x8001)
        parts = self.document["builds"][0]["parts"]
        parts[0], parts[1] = parts[1], parts[0]
        self.write_metadata()
        self.assert_rejected("overlapping erase-sector interval")

    def test_rejects_nvs_coredump_and_history_boundaries(self) -> None:
        for part_index, size, partition in [(1, 0x1001, "nvs"), (2, 0x3001, "coredump"), (3, 0x400000, "history")]:
            with self.subTest(partition=partition):
                self.setUp_boundary(part_index, size)
                self.assert_rejected(f"overlapping {partition}@")

    def setUp_boundary(self, part_index: int, size: int) -> None:
        for index, (name, _, original_size) in enumerate(PARTS):
            (self.root / name).write_bytes(bytes([0xa5 + index]) * (size if index == part_index else original_size))
        self.document["provenance"]["app_sha256"] = self.digest(self.root / APP_NAME)
        self.write_metadata()

    def test_rejects_application_not_bound_to_verified_app_hash(self) -> None:
        self.document["provenance"]["app_sha256"] = "0" * 64
        self.write_metadata()
        self.assert_rejected("does not match verified application provenance")

    def test_rejects_manifest_index_drift_and_wrong_part_bytes(self) -> None:
        self.index["manifest_sha256"] = "0" * 64
        self.write_index()
        self.assert_rejected("does not bind this exact manifest")
        self.write_metadata()
        app = self.root / APP_NAME
        app.write_bytes(app.read_bytes()[:-1])
        self.assert_rejected("does not match artifact index size or SHA-256")

    def test_rejects_same_length_corruption(self) -> None:
        path = self.root / PARTS[0][0]
        data = bytearray(path.read_bytes())
        data[0] ^= 1
        path.write_bytes(data)
        self.assert_rejected("does not match artifact index size or SHA-256")

    def test_requires_explicit_erase_choice(self) -> None:
        self.document["new_install_prompt_erase"] = False
        self.write_metadata()
        self.assert_rejected("new_install_prompt_erase must be true")

    def test_rejects_missing_non_file_and_symlink_parts(self) -> None:
        app = self.root / APP_NAME
        app.unlink()
        self.assert_rejected("missing or not a regular file")
        app.mkdir()
        self.assert_rejected("missing or not a regular file")
        app.rmdir()
        app.symlink_to(self.root / PARTS[0][0])
        self.assert_rejected("not a regular file")

    def test_rejects_unsafe_inventory_names_and_invalid_size_hash(self) -> None:
        for field, value, message in [
            ("path", "../app.bin", "path is unsafe or duplicate"),
            ("path", "https://foreign.test/app.bin", "path is unsafe or duplicate"),
            ("size", True, "invalid size or SHA-256"),
            ("size", 0, "invalid size or SHA-256"),
            ("sha256", "X" * 64, "invalid size or SHA-256"),
        ]:
            with self.subTest(field=field, value=value):
                self.write_metadata()
                self.index["artifacts"][0][field] = value
                self.write_index()
                self.assert_rejected(message)

    def test_rejects_boolean_offset_and_duplicate_json_keys_cleanly(self) -> None:
        self.document["builds"][0]["parts"][0]["offset"] = True
        self.write_metadata()
        self.assert_rejected("invalid part entry")
        self.manifest.write_text('{"version":"1.2.3","version":"9.9.9"}', encoding="utf-8")
        self.assert_rejected("duplicate metadata key")
        self.manifest.write_text("{", encoding="utf-8")
        self.assert_rejected("cannot read")

    def test_official_layout_is_8_mb_and_preserves_deployed_offsets(self) -> None:
        rows: dict[str, tuple[int, int]] = {}
        for raw in (ROOT / "partitions.csv").read_text(encoding="utf-8").splitlines():
            line = raw.strip()
            if not line or line.startswith("#"):
                continue
            fields = [field.strip() for field in line.split(",")]
            rows[fields[0]] = (int(fields[3], 0), int(fields[4], 0))

        self.assertEqual(rows["nvs"], (0x9000, 0x6000))
        self.assertNotIn("history_full", rows)
        self.assertEqual(rows["ota_0"], (0x20000, 0x1F0000))
        self.assertEqual(rows["ota_1"], (0x210000, 0x1F0000))
        self.assertEqual(rows["history"], (0x400000, 0x400000))
        self.assertEqual(max(offset + size for offset, size in rows.values()), 0x800000)

        sdkconfig = (ROOT / "sdkconfig.defaults").read_text(encoding="utf-8")
        self.assertIn("CONFIG_ESPTOOLPY_FLASHSIZE_8MB=y", sdkconfig)
        self.assertNotIn("CONFIG_ESPTOOLPY_FLASHSIZE_4MB=y", sdkconfig)


if __name__ == "__main__":
    unittest.main()
