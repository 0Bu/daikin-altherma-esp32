#!/usr/bin/env python3
"""Negative-path tests for the NVS-preserving Web Serial manifest gate."""

from __future__ import annotations

import json
import subprocess
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
CHECKER = ROOT / "scripts" / "check-web-installer-plan.py"


class WebInstallerPlanTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        self.partitions = self.root / "partitions.csv"
        self.partitions.write_text(
            "# Name, Type, SubType, Offset, Size, Flags\n"
            "nvs,data,nvs,0x9000,0x6000,\n"
            "otadata,data,ota,0xf000,0x2000,\n"
            "ota_0,app,ota_0,0x20000,0x1f0000,\n",
            encoding="utf-8",
        )
        self.image = self.root / "app.bin"
        self.image.write_bytes(b"\xa5" * 64)
        self.manifest = self.root / "manifest.json"

    def tearDown(self) -> None:
        self.tmp.cleanup()

    def write_manifest(
        self,
        *,
        path: str = "app.bin",
        offset: object = 0x20000,
        erase_prompt: object = True,
    ) -> None:
        self.manifest.write_text(
            json.dumps(
                {
                    "name": "daikin-altherma-esp32",
                    "version": "1.2.3",
                    "new_install_prompt_erase": erase_prompt,
                    "builds": [
                        {
                            "chipFamily": "ESP32-S3",
                            "parts": [{"path": path, "offset": offset}],
                        }
                    ],
                }
            ),
            encoding="utf-8",
        )

    def run_checker(self) -> subprocess.CompletedProcess[str]:
        return subprocess.run(
            [str(CHECKER), str(self.manifest), str(self.partitions)],
            text=True,
            capture_output=True,
            check=False,
        )

    def assert_rejected(self, message: str) -> None:
        result = self.run_checker()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn(message, result.stderr)
        self.assertNotIn("Traceback", result.stderr)

    def test_accepts_part_whose_erase_sectors_skip_nvs(self) -> None:
        self.write_manifest()
        result = self.run_checker()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("nvs@0x9000-0xefff is untouched", result.stdout)

    def test_rejects_part_that_erases_nvs(self) -> None:
        self.write_manifest(offset=0x9000)
        self.assert_rejected("overlapping nvs@0x9000-0xefff")

    def test_requires_explicit_erase_choice(self) -> None:
        self.write_manifest(erase_prompt=False)
        self.assert_rejected("new_install_prompt_erase must be true")

    def test_rejects_missing_and_non_file_parts(self) -> None:
        self.write_manifest(path="missing.bin")
        self.assert_rejected("part cannot be read")
        (self.root / "directory").mkdir()
        self.write_manifest(path="directory")
        self.assert_rejected("part is not a regular file")

    def test_rejects_paths_outside_manifest_directory(self) -> None:
        outside = self.root.parent / f"{self.root.name}-outside.bin"
        outside.write_bytes(b"x")
        self.addCleanup(outside.unlink, missing_ok=True)
        self.write_manifest(path=f"../{outside.name}")
        self.assert_rejected("part escapes the manifest directory")

    def test_rejects_boolean_offset_and_malformed_json_cleanly(self) -> None:
        self.write_manifest(offset=True)
        self.assert_rejected("invalid part entry")
        self.manifest.write_text("{", encoding="utf-8")
        self.assert_rejected("cannot read")


if __name__ == "__main__":
    unittest.main()
