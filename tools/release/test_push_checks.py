#!/usr/bin/env python3
"""Verify the local pre-push phase ordering and propagation of failures."""

import subprocess
import tempfile
import threading
import unittest
from pathlib import Path
from unittest.mock import patch

import push_checks


class PushChecksTests(unittest.TestCase):
    def run_candidate(self, fail_phase=None):
        build_started = threading.Event()
        host_started = threading.Event()
        build_finished = threading.Event()
        host_finished = threading.Event()
        phases = []
        with tempfile.TemporaryDirectory(prefix="daikin-push-check-fixture-") as scratch:
            host = Path(scratch) / "host"
            firmware = Path(scratch) / "firmware"
            host.mkdir()
            firmware.mkdir()

            def run(command, *, cwd, env, check, **kwargs):
                if command[0] == "scripts/idf-docker.sh":
                    self.assertEqual(cwd, firmware)
                    build_started.set()
                    self.assertTrue(host_started.wait(5), "host must run while the compiler is active")
                    build_finished.set()
                    phase = "firmware"
                elif command[0] == "scripts/check-nonflashable-artifacts.sh":
                    self.assertEqual(cwd, firmware)
                    self.assertTrue(build_finished.is_set() and host_finished.is_set())
                    phase = "artifacts"
                else:
                    self.assertEqual(cwd, host)
                    phase = command[2]
                    if phase == "host":
                        self.assertTrue(build_started.wait(5), "compile must overlap host checks")
                        host_started.set()
                        host_finished.set()
                    else:
                        self.assertEqual(phase, "browser")
                        self.assertTrue(build_finished.is_set() and host_finished.is_set())
                        self.assertIn("artifacts", phases)
                phases.append(phase)
                if phase == fail_phase:
                    raise subprocess.CalledProcessError(1, command)

            with patch.object(push_checks.subprocess, "run", side_effect=run), \
                    patch.object(push_checks.local, "verify") as verify:
                args = (host, {}, firmware, {}, "a" * 40, "b" * 40, "c" * 40)
                if fail_phase:
                    with self.assertRaises(subprocess.CalledProcessError):
                        push_checks.check_candidate(*args)
                else:
                    push_checks.check_candidate(*args)
                verify.assert_called_once_with(host, expected_head=args[4], require_receipt=True, fresh=True)
        self.assertTrue(build_finished.is_set() and host_finished.is_set())
        return phases

    def test_host_and_firmware_overlap_and_browser_runs_last(self):
        self.assertEqual(self.run_candidate()[-2:], ["artifacts", "browser"])

    def test_failure_in_either_worker_prevents_browser(self):
        for phase in ("firmware", "host"):
            with self.subTest(phase=phase):
                self.assertCountEqual(self.run_candidate(phase), ["firmware", "host"])

    def test_artifact_validation_failure_prevents_browser(self):
        self.assertEqual(self.run_candidate("artifacts")[-1], "artifacts")


if __name__ == "__main__":
    unittest.main()
